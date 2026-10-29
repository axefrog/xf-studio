# PREV-196: warm restart preparation

Step 1 is merged at **main `19c366b7`**, improving warm restart from **9.9-10.6 s to 5.6-7.7 s**. Step 2 is merged at **main `675e5370`**, MERGE-reviewed, full suite **4,936/0**, scene runtimes **28/0 alone**; the complete warm V appears at **3.1-3.5 s**. Step 3 is uncommitted on `claude/perf-restart-3`: start the authoritative V request before core setup, overlap independent setup reads, yield bulk core verification, and revalidate warm core assets without retransferring their bytes. Strict GPU completion remains. **126 targeted guarded tests pass**; no new runtime number is claimed. **<2 s remains open**.

## Measurements

Latest coordinator measurements (page time unless noted):

| Candidate | Blink | Host solver-ready log | V preparation / placement / frame |
|---|---|---|---|
| `ef601ead` | Asked about 1.85 s, answered about 2.35 s (0.5 s) | About 3.8 s server time | Prepared about 3.1 s; placed about 3.15 s; frame 3.2–3.3 s |
| `59e59ed0` | Answered 4.7–5.65 s (2.8–3.6 s request duration) | 5.0–6.0 s server time; creator options read in 5.0–5.4 s | Prepared 2.8–2.9 s; placed 4.7–5.7 s; frame 4.7–5.7 s |
| `22bb619b`, 50 ms grace (three warm runs) | Asked about 1.8 s, answered 3.9–4.45 s | Solver ready 2.54 s once, 5.5 s twice | Prepared 2.66–2.84 s; placed/frame 4.0–4.5 s |
| `879a3ff5`, native lanes | Answered 0.8–1.0 s after request | Not separately reported | Whole V frame 3.1–3.5 s warm |
| Reverted local 2000 ms experiment (three warm runs) | Asked about 1.95 s, answered 3.9–4.04 s | Solver ready 2.56–2.60 s; creator options read in 3.6 s | Frame 3.93–4.07 s |

The experiment is not a committed candidate. It shows that holding cooperative ahead CPU longer does not remove the native I/O backlog. The committed 50 ms grace remains: 2000 ms has no established blink benefit and would impose much longer repeated delays on cooperative dependencies. Parts prepare earlier, but publication still joins complete motion; that behavior remains intentional. Earlier detailed marks from `d418e83f` (milliseconds), whose whole V was 2.92–2.95 s:

```text
ask 900–1050
loaded 1770
details:uploads 2140
details:drained 2860
frame 2920–2950
```

Before step 2, loaded was 4.1–6.2 s and blink answered at 3.9–6.1 s while creator presentation, background V resolve and archive indexes competed with facial work. The new measurement confirms the combined priority/overlap improvement; it does not isolate each change's contribution. The 720 ms uploads → drained interval still includes bake/program/link work and completion waits.

Coordinator gates on step 2 are complete: **main `675e5370`**, MERGE review, full suite **4,936/0** and scene runtimes **28/0 alone**. The earlier native-boundary and view-graph-audit failures and shared-read priority finding are fixed. Typecheck was clean; desktop **135/0**, 038 **11/0**, startup/substitution browser tests, resources **8/0**, GPU **124/0** and latency had already passed on the prior native-lane checkpoint. These are step-2 proofs; the step-3 candidate has only the targeted tests below.

## 1. Host: first-frame demand uses the shared lanes

**Cause [source]:** creator presentation waited only for person jobs; poses and facial control analysis used fair slices without the shared lane policy. A whole facial preparation is not a suitable single-slot job: it later waits indefinitely for an Expressions request, and other reads depend on its rig. Holding that slot while waiting for another job would deadlock dependencies.

**CPU policy (`22bb619b`, retained):** cooperative read turns use person > shown > ahead, with 1 ms ahead slices and fixed, non-renewable 50 ms eligibility deadlines while shown reads are in flight. These clock deadlines cannot wait on another operation completing. Preparation jobs alone retain slot/tail/hold/quiet barriers. **Native policy (current fix):** all request kinds share person > shown/default > background queue order. A host adapter stamps the current lane on requests at the shared installation port (ahead maps to background), unless the caller explicitly chose a priority. It covers document fetches and direct animation/texture/mask/geometry calls. The active request finishes, then the highest queued lane runs, FIFO within that lane. No scheduler completion permit, timer or second worker is added.

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

**Cause:** `ef601ead` could make a lookup tail wait for exclusive Clear while Clear awaited that tail. Removing async-scope barriers solved those cycles, but also allowed much more ahead native work to be submitted during shown I/O. The decoder already had a special background queue for explicitly marked text/prefetch requests; ordinary creator CCO reads carried no lane and entered its normal FIFO. CPU grace alone cannot reprioritise an already-submitted native backlog. The second coordinator trace establishes that this is the remaining large delay.

**Design:** keep the cycle-free pump and add bounded grace for ahead reads while any wanted shown read is in flight. Every ahead CPU ticket records `notAfter = queuedAt + 50 ms` once. The pump admits it earlier if no shown read remains; new shown reads never move that ticket's deadline. At its deadline it competes normally by lane/FIFO, regardless of running jobs, tails, holds, dependencies or exclusivity. Ahead readers yield at 1 ms while shown reads are active, otherwise at the ordinary 8 ms. Slices remain cooperative: one indivisible scan/solve unit can overrun them. Only cooperative shown reads trigger grace, never a queued/running exclusive person job. Abort immediately withdraws a shown read's influence even if its callback has not returned; success/failure also release it in `finally`.

**Why no dependency wait-cycle can form:** a read's eligibility depends on its fixed monotonic deadline, not another operation completing. Even a shown → shared ahead lookup → stopped parent's tail → Clear chain cannot keep the lookup ineligible past that deadline. A grant holds no permit across I/O. Thus the scheduler adds no reverse completion edge to an operation waiting on the read. Finite ready work drains after bounded grace; continuously ready higher CPU work can still starve lower priority work, but a caller awaiting that dependency is not itself ready. As before, external I/O needs its owner's deadline/cancellation.

**Grace and trade-off:** retain the measured 50 ms CPU grace. The reverted 2000 ms experiment did not restore the short blink response; extending a CPU eligibility delay cannot fix requests already queued to the decoder. The native queue fix adds no worker heap, data copies, cache schema or completion dependency. Its trade-off is deliberate: queued ahead work finishes later while person/shown requests are waiting. One already-running request (and a cold worker's startup) remains non-preemptive and bounded by existing worker budgets. Installing a new worker for catalogue CPU remains a separate option if contention survives remeasurement.

**Regressions:** eight 5 ms shown I/O gaps finish at 40 ms with no ahead CPU admitted; ahead starts immediately when shown ends. A long shown read allows ahead at its original 50 ms deadline despite new shown activity, then enforces the 1 ms slice; ordinary slices return after shown ends. A shared ahead lookup joined by shown work and retained through a stopped parent's `afterwards()` drains before exclusive Clear and a later person job. Failure and abort on either side leave zero wake timers, including an abandoned shown callback. Prior occupied-slot/tail cycles, dependency reads in every parent lane, person holds, immediate person response and priority tests remain green. Admission-order tests now assert bounded grace as well as order; no browser/performance timing gate was changed.

**Files:** `src/platform/core/jobs.ts`, `src/platform/api/jobs.ts`, `tests/jobs.test.ts` under `projects/xf-studio/authoring/`, plus performance/ledger and knowledge notes. No page, GPU, desktop wiring or host catalogue algorithm changes.

## Native queue correction after the blink probes

**Evidence [coordinator offline trace + source]:** the outer probe located 1.82 s in rig readiness, with 13 ms clip baking and 0.33–0.35 s morph fetching. The inner probe (warm run 3) instead had the rig ready at host time 2623 ms before blink arrived at 2797.7 ms. Head/eye morph fetches then ran 2807–4983/5026 ms. The head request waited **1708.0 ms** before sending and took **466.9 ms** from send to reply; the eyes waited **2174.2 ms**, then took **42.6 ms**. Their `behind` snapshots name queued creator decodes. The run contains 328 native requests, 253 creator `gameuiCharacterCustomizationInfoResource` decodes, with 4.7 s aggregate post-send time. This confirms a native queue backlog, rather than an analysis dependency. Page marks (ms): ask 1107, loaded 2088, prepared 2853, placed 4256, frame 4271. Private traces remain coordinator-owned; no payload is copied into this worktree.

**Fix (committed as `879a3ff5`, wrapper now routed through `native-fetch-port.ts`):** the shared installation decoder preserves identity, optional capabilities, close/can-answer behavior and sole worker ownership. Requests inherit person/shown/background priority from the current host lane; an explicit submission priority wins. Every native request kind carries that metadata. The worker selects person, then shown/default, then background, preserving FIFO within each bucket. The creator CCO reads therefore use the background bucket, not the facial reads' FIFO. Direct pose/idle animation calls use the same port. Facial expression prefetches explicitly raise later requests to shown when the view opens, overriding the inherited ahead context while preserving person priority. Shutdown and failed startup settle all three queues. Shared-consumer inheritance is described below.

**Why this cannot introduce a wait-cycle:** priority changes only which queued request is sent next. It never waits for a host job, tail, hold, rig promise or async scope to finish. The worker executes a resource operation independently of the requester and releases its single execution slot on reply/failure. A caller awaiting a lower-lane resource does not occupy that worker slot. Thus no reverse completion dependency is added. Finite queued work progresses; continuous higher demand can delay background work by policy.

**Installation acquire (about 0.65 s):** the path performs shared installation opening/validation, including discovery/index/XL preparation or watched-path checks. The registry already single-flights opens/checks and bounds parallel reads/stats; it has no scheduler-lane wait here. The current trace does not distinguish an initial/shared open from a revalidation, so this fix retains all staleness checks. Opt-in acquire logs now include registry open/check counters for the next measurement. The face-rig `.app` request's 199 ms pre-send time had `behind=idle`: native `wait` also includes worker startup, not only queue backlog; its 243 ms post-send time includes worker service and reply delivery. Neither number is claimed removed by queue priority.

**Morph overlap:** considered and left unchanged for this correction. The validated installation suffices to request morph documents, but the requests share the essential rig reads' single worker. Submitting them before skeleton/setup can move their cost into rig readiness. In the latest trace rig readiness already preceded blink demand; the removable cost was 1.7–2.2 s of queued ahead work, while the two morph reads themselves still consumed about 0.51 s. Measure the priority fix before introducing earlier speculative reads or another readiness/lifetime signal. Single-flight blink baking, full motion before publication and morph-seat arithmetic remain intact.

**Optional diagnostics:** `XFS_TRACE_BLINK=1` retains rig/response phase logs plus native requests taking at least 50 ms. Native lines show kind/hash/priority, queued-to-send `wait`, send-to-reply `run`, work already ahead at enqueue, and outcome. Timing uses weak keys, cleared on reply/owner close, and creates no timers or fences. Logging is off by default. The CPU grace is still 50 ms.

**Native-lane files** under `projects/xf-studio/authoring/`: `src/game/host/resolver-host.ts`; `src/native/native-fetch-port.ts`, `native-priority.ts`, `native-decode.ts`, `anim-decode.ts`, `texture-decode.ts`, `mesh-decode.ts`; `src/animation/host/facial-native.ts`, `facial-host.ts` (optional diagnostics); `tests/native-decode-lanes.test.ts`. The separate game/host wrapper is removed in the boundary correction below.

## Shared-read inheritance and boundary correction (merged in 675e5370)

**Cause:** the graph memoises resource/model promises. A person joining one started by ahead work bypassed native submission, leaving its queued read at background priority. Continuous shown demand could starve that person; decode budgets start only after send and do not bound this queue wait.

**Fix:** an optional `ResourceFetchPort.promote` hook accompanies an existing resource read, and model asks promote both their own document and applicable patch sources. The graph resolves copies/links to the actual archive/hash without changing provenance, read recording or promise identity. Native fetches enqueue synchronously before yielding, and model builders start applicable patch sources before awaiting their base document, so their pending native reads already exist when another caller joins. The public native fetch port evaluates the joining caller's current lane and raises matching queued operations, across all five kinds, to its lane. Promotion appends at the higher lane's tail once; equal/lower joins neither demote nor reorder. Active work is untouched. No duplicate fetch, retained promotion registry, new timer, fence or worker is introduced. A stopped caller does not cancel a read shared with others.

**No-cycle argument:** submission/promotion only selects or moves independent queued resource operations. It never waits for a consumer, host job, tail, hold, rig promise or async scope. Worker completion releases the existing execution slot. Therefore it adds no reverse completion edge to a consumer awaiting the read. A person's inherited request cannot be starved by shown arrivals; older person work and the one active request still precede it.

**Boundary fixes:** lane stamping now lives inside the existing `src/native/native-fetch-port.ts` public surface, with a host-supplied priority callback. `ResolverFetcher` supplies the lane mapping; the separate game/host lane-wrapper module is removed. Native code imports no host scheduler. The browser head attachment derives its preparation handoff type from its existing viewport port instead of importing `platform/scene/scene-host`. No allowlist or ratchet changed, and preparation/publication behavior is unchanged.

**Step-2 correction files:** `src/game/resource-graph.ts`, `src/game/host/resolver-host.ts`; `src/native/native-decode.ts`, `native-fetch-port.ts`, `native-priority.ts`; `src/preview/browser/browser-head-attachment.ts`; `tests/native-decode-lanes.test.ts`, plus the performance/ledger and knowledge notes. The former game/host lane-wrapper module is deleted.

## Step 3: startup dependencies and warm core transfers (uncommitted)

**Coordinator baseline, warm run 3 on `ef969caa` (the merged step-2 lineage):** page milliseconds. The speculative kept-V request is 211-445; local-settings 461-951; preview-core 993-1262; core record 1370-1530; a second local-settings read 1301-1597. Real V ask 1371, answer 1620, record 1641; head.glb 1620-2030 (12 MB), core maps complete by 2091; loaded 2262, uploads 2685, drained 3310, prepared 3361, placed 3369, frame 3410. Runtime program/warm-up marks 4267-4632 occur after that measured frame. No phase boundary or definition of the V's frame was moved.

### 1. Ask for the authoritative V before core setup

**Cause [source]:** the early request belongs to `CharacterWarmStart`: it only probes a remembered kept answer and cannot decide what is displayed. The real detail service was created by `buildBrowserHead`, which setup reached after WolvenKit/core checks. Profiles/library data, not the remembered warm request, determines the current V.

**Fix:** once the active profile/session and its character context exist, the scene-head owner primes the real `CharacterDetailActions` service without constructing a scene. The same service issues the real POST and reads its record, then waits on deferred preparation/scene ports. `buildBrowserHead` adopts it only when the character/request still match. Context changes before setup replace it; release aborts it, and a failed build releases it. Empty scenes request nothing. Preparation still needs the stable rig surface and placement still needs complete motion, with the existing cancellation recheck. No second request/display owner or speculative remembered-V preparation is added. The earliest safe ask is now authoritative-context availability, independent of core/local-settings completion; whether that reaches 0.2-0.3 s needs measurement.

**Files:** `src/preview/browser/browser-head-attachment.ts`, `browser-scene-heads.ts`; `src/compose/studio-startup.ts` (one wiring call). Tests observe actual POSTs, not method-call counts: one request across adoption; replacement after a body change; abort before a head exists. Existing successful placement, motion, supersession and context-loss cases remain.

### 2. Small host reads and the duplicate settings request

**Cause [source]:** neither GET is queued as a preparation job. Settings includes a per-request Windows Saved Games `reg.exe` query and synchronous advisory path/framework checks; the registry wait is a plausible contributor to 0.3-0.5 s, not an isolated timing proof. Core readiness synchronously hashes roughly 20 MB. Setup also awaited WolvenKit before asking for core state. Its first observation of an already-ready core triggered another settings read even though no preparation had occurred; that second read was concurrent with head loading, not its direct prerequisite.

**Fix:** setup checks WolvenKit/core concurrently and refreshes settings only on an actual non-ready-to-ready core transition. The host prewarms/single-flights the fixed Saved Games query and memoises that advisory result for five seconds without an expiry timer; settings writes, chosen paths and actual save-file location resolution remain fresh/unchanged. Core HTTP readiness retains the exact recipe/stamp/manifest/size/hash checks but hashes via asynchronous 256 KiB file reads. Shared check consumers have separate AbortSignals: one cancellation leaves other readers running, the last cancellation aborts verification, and every opened file closes in finally. Obsolete checks cannot publish after invalidation/settings changes; archive stamps are checked again after verification. No scheduler permit is held across these reads and no priority wait edge is added.

**Files:** `src/preview/preview-setup.ts`; `src/preview/host/preview-core-service.ts`, `preview-core-host.ts`, `preview-core-server.ts`; `src/saves/host/saves-host-sources.ts`. Tests cover independent setup admission, initial-ready versus completed-preparation refresh, registry sharing/expiry, async parity and same-size corruption, and shared-read cancellation.

### 3. Keep completion protection; separate the 0.6 s interval

**Decision [source + existing fake-GPU proofs]:** uploads-to-drained also includes pre-bake completion, layered baking, program submission/link readiness and the final first-use barrier. It is not evidence for an unnecessary single 0.6 s fence. Bakes' error/readback checks and first-use uniforms/attributes are synchronous calls that can block behind GPU-process backlog (G2). Retain the strict barriers, existing link overlap, revision refresh and 120-frame bound; elapsed time cannot substitute for completion on an idle page. No new fence or timer is introduced.

**Diagnostic fix:** bounded phase marks now include `details:maps-drained`, `details:baked`, `details:programs`, `details:linked`, before the existing `details:drained`. This lets the coordinator separate bake/link time from the final report delay before choosing another overlap. Files: `src/platform/scene/character-renderer.ts`, `src/character/character-timing.ts`. Existing fake-fence first-use/backlog/cancellation tests pass unchanged. No browser/GPU result is claimed.

### 4. Reuse the warm head's bytes after validation

**Cause [source]:** both hosts serve head.glb through `Bun.file` on every GET with no-cache and no explicit content validator. The 0.4 s includes transfer, host scheduling and browser work; it is not a measured disk-only cost.

**Fix:** a shared core asset handler supplies a strong ETag from the validated manifest hash and `private, no-cache`. Conditional GET/HEAD still validates readiness and file existence/realpath containment; unchanged bytes return 304. Both hosts use it. There is no embedding of private game data in the page and no new retained 12 MB host buffer. Changed/invalid/missing core entries cannot be vouched for by a caller's old ETag. Browser parsing remains necessary. Files: `src/preview/host/preview-core-host.ts`, `preview-core-server.ts`, `server.ts`, `desktop/server.ts` (routing only). The asset-free HTTP regression proves 200/304, changed tags, HEAD and invalid/missing refusal.

## Validation and handoff

**126/0 targeted tests across ten files**, one Bun process at a time under the required **4 GB guard**, peak **0.6 GB**: browser-scene-heads, browser-head-attachment, character-detail-context, character-renderer, preview-core, preview-preparation, preview-setup, restart-host-reads, local-setup-actions, warm-start-lifetime. Fixtures use fake scenes/GPU/registry and private synthetic files; no real-game probe or external registry command was run for validation. No existing timing gate was relaxed.

`git diff --check` passes. Per the maintainer's sandbox handle rule, no whole-tree walker, link/private-path/footprint/audit script, browser/GPU/typecheck/desktop/full/latency gate ran. Those checks and candidate re-review belong to the coordinator. No task scratch/payload is retained. Changes are uncommitted.

**Next measurement:** compare actual ask/answer/record and the core record/head file ranges with step 2; confirm a single POST is adopted and a warm head validates by ETag. Capture the four new details phase marks to isolate the retained 0.6 s. **Remaining path to 2 s:** authoritative profile/context startup, necessary core/V decode and parsing, GPU uploads and strict completion. Earlier requesting and cached transfer may overlap these costs, but 2 s is not established until the coordinator remeasures. No game or mod-manager operation is needed.

## Step 1 evidence retained

The first candidate `2e57ae9f` regressed to 20.3–20.7 s despite asking for the V at 1 s: per-band fences multiplied quiet-context reports of 200–250 ms. The window commit `da926994` reached 6.4–6.8 s, with uploads 0.4 s after loaded. Subsequent review fixed later-work admission, warm-character fence retention, the pose poll's unowned 700 ms timer and a separate one-second face poll; continuous rendering then exposed fence replacement starvation. The merged design retains pending admission barriers, grants a bounded burst on completion and carries intervening work into the next checkpoint. The shell-repaint explanation for delayed Chrome reporting remains a hypothesis. Those fixes are now MERGE-reviewed and validated by the coordinator's green full/GPU/browser/resource gates on `19c366b7`.

**Knowledge used:** [native archive reader](../../knowledge/archive-format.md#8-reading-untrusted-files-safely), [WebGL linking/uploads](../../knowledge/webgl-program-linking.md), [mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction), [facial animation](../../knowledge/facial-animation.md), [body animation](../../knowledge/body-animation.md), [knowledge rules](../../knowledge/README.md). Updated merged step-2 evidence and step-3 startup/HTTP/cache findings. Candidate review, measurement and full gates remain pending; whole-tree checks stay in the coordinator shell.
