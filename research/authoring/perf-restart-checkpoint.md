# PREV-196: warm restart preparation

The upload window committed as `da926994` improves warm restart to **6.4–6.8 s**, versus paired main `f37aaa53` at 9.9–10.6 s; uploads finish about **0.4 s after loaded** (coordinator measurement, 29 October 2026). The **<2 s budget remains open**. This worktree contains the uncommitted fix for the independent review's High finding and the coordinator's type/resource gate failures; its browser remeasurement/review is pending.

## Baseline and measurement handoff

The coordinator's `tools/measure-warm-restart.ts` baseline used an isolated server, the default V, and kept caches and Chrome profile; runs 2–4 were warm. The complete V appeared at **10.3–10.5 s from page start**, superseding the earlier 2.8–3.0 s result. One warm timeline, in milliseconds:

```text
ask 5814 → answer 5945 → record 5976 → loaded 6119 → prepared 10429 → placed 10435 → frame 10464
```

The kept host answer was checked in 117 ms. Creator options occupied the host for about 3.9 s, delaying blink/facial/idle answers; the V's ordinary request followed those answers. The loaded-to-prepared interval consumed another 4.3 s on the page. The page profile shows repeated dock loads and tab-header layout reads, tab/scene clones, starter projections and module descriptor clones.

**Measured first candidate:** back-to-back on the same machine/load, with the game running at about 45% GPU throughout both versions, main `f37aaa53` drew the V at **9.9 / 10.6 s** (loaded at 5.8 s). Candidate `2e57ae9f` drew it at **20.3 / 20.7 / 20.3 s**: asked at 1.0 s, loaded at 4.1–5.5 s, `details:uploads` at 18.2 s. Preparation took about 15 s with the page about 85% idle and rAF steady at 60 Hz. Earlier request/loading improved; total time regressed.

**Measured upload window (`da926994`):** whole V at 6.4–6.8 s warm; uploads take 0.4 s after loaded. Its independent Sol review returned **FIX**, one High: later non-map GPU work could bypass the opening fence while upload credit remained. The coordinator's gates also found three type mismatches, a live sync after cancelling a compiling preparation, and one timer after the normal painted application released. Both resource failures reproduce alone on a quiet machine and pass on main. The coordinator's 134 targeted passes on that commit do not establish resource correctness.

**Current correction: browser marks and resource gates pending coordinator.** Prime source-invalidated kept answers and repeat the same warm setup. Recheck upload durations under busy GPU-process work as well as `details:uploads` and full frame. Rerun the scene-runtime cancel row and normal painted startup-resource row. No Chrome, browser gate, latency gate, 038 harness, desktop test, suite batch or typecheck ran in this correction; the coordinator explicitly retained all browser/GPU runs in their shell.

## Upload fences: the measured regression and follow-up

**Observed:** the coordinator's WebGL2 prototype wrapper found no draws during preparation in either build. Main sent 25–46 fences/s, 48–116 unsignalled polls/s and 23–43 `texSubImage2D` calls/s; uploads finished about 3 s after loaded. Candidate sent only 3–6 fences/s and 3–5 uploads/s for about 14 s while polling about 120 times/s. Chrome's own 3D-engine use stayed at 1–2%; a fence took 200–250 ms to report signalled. The prior [quiet-context probe](../../knowledge/webgl-program-linking.md#8-a-second-runtime-of-one-v-what-it-costs-and-what-it-shares) also found 230–290 ms status delays. The explanation that former shell repaints kept Chrome's GPU channel active remains a **hypothesis**, not a verified Chrome mechanism.

**Verified amplification [source + offline CPU tests]:** `upload()` marked after every band/storage allocation, and both `uploadAll` and `streamUploads` required that fence to pass before the next step. Runtime preparation did the same. Thus each late status serialised another band, even when no GPU work was busy. A no-draw fake reporting completion fifteen frames late reproduces 24 bands taking 345 frames with the former gate pattern; the new window takes 45 frames, including its opening wait. This verifies the serial-wait mechanism, not the browser's reason for delayed reporting.

**Design:** one reference-counted upload window per renderer, shared by streaming, detail preparation and runtime preparation. Admission accounts for the next whole upload or actual band (including a short tail), with one credit for storage allocation. At most **16,777,216 texels** remain outstanding (64 MiB for RGBA8). A separate admission barrier covers preceding non-map GPU work, initially and after later submissions. The shared owner observes the renderer's render, compile, texture, target-allocation and clear entry points while uploaders want it; this includes internal Three passes, layered bakes and morph uploads. Submissions only mark admission dirty. The next upload attempt makes one fence covering all intervening work, and waits for it even if texel credit remains. No submission means no new barrier. Only the admitted map destination's own init/copy calls are exempt; nested draws or other textures still invalidate admission.

Turns checkpoint combined map uploads before yielding, at completion or when the window fills. Several bands/frames can proceed within that window; a full window sends nothing until a checkpoint reports completion. Only that checkpoint's credit is returned, with no timed release or extra draws. Map draining ignores later non-map barriers, since morph rounds/warm-up retain their own completion policy. Explicit upload waits fail closed after 120 frames; optional streaming stops polling after 120 turns without progress. The 8 ms CPU share and 512-row bands remain. An indivisible fallback larger than the window goes alone. Context loss discards the generation's fences/credit and requires a new initial barrier. Later submissions while a barrier is pending invalidate it again: continuous work cannot bypass safety by spending spare credit.

**Fence lifetime:** each detail preparation leases the window in `try/finally`; streaming leases it only while its queue runs. Character disposal aborts preparations and releases any live leases immediately. Merely keeping a warm character no longer keeps a fence alive. The last uploader deletes all live fences and restores the renderer methods; a future uploader's opening barrier covers any earlier uploads still processing. Concurrent active uploaders still share one window.

`gpuDrained` remains a true barrier before bakes and synchronous program first uses. Runtime maps finish before morph uploads and before warm-up consumes them; morph memory fills can continue meanwhile. Morph uploads already batch a round behind one fence and retain their Float32 upload barrier. Warm-up barriers remain because a draw can build costly shader variants: permitting another draw before completion would remove their protection. The link pacer already admits 2–6 concurrent links and waits only when full using actual `COMPLETION_STATUS_KHR`, so it is unchanged. None of those waits is repeated for each map band now.

**Files** (under `projects/xf-studio/authoring/`): new `src/platform/scene/gpu-upload-budget.ts`; `src/platform/scene/character-renderer.ts`, `runtime-preparation.ts`, `gpu-gate.ts`; next-step accounting in `src/character/render/character-detail-loader.ts`. Tests: `tests/link-pacing.test.ts`, `character-preload.test.ts`, `character-renderer.test.ts`, `runtime-preparation.test.ts`, with `tests/fixtures/slow-upload-renderer.ts`.

## Review and gate corrections on `da926994`

- **High, later busy work:** `src/platform/scene/gpu-work.ts` observes submissions for the shared budget; `gpu-upload-budget.ts` separates texel checkpoints from the invalidated admission barrier. `character-detail-loader.ts` scopes the actual map step by destination. New `tests/gpu-upload-work.test.ts` exercises each submission path, repeated invalidation, coalescing, real Three morph uploads, nested work, exception/return preservation, sharing and generation loss. The runtime fake now makes the GPU busy after three bands with ample spare credit: no upload is sent for fifteen frames, then several bands resume. The unchanged no-draw slow-fence tests retain their throughput assertions.
- **Cancelled preparation sync:** the former character-wide upload lease survived completed preparations in otherwise warm runtimes. Scoped leases in `character-renderer.ts` release on success, cancellation, exception and renderer disposal. The regression now requires **zero** live fences as soon as preparation completes/stops, including cancellation during compilation and disposal with a link reply held; the former assertion allowed one until renderer disposal. This strengthens the resource contract rather than relaxing the GPU gate.
- **Types:** generator inputs in `pose-catalogue.ts` accept `ReadonlyMap`, matching the public reader; `panel-header.ts` explicitly keys its next-header map by `Element`; the slow-upload fixture narrows `texture.image` before reading dimensions. Projection/header tests retain their original assertions. Typecheck remains coordinator-owned.
- **Reported 700 ms timer [coordinator probe + source/CPU]:** the probe identifies `timeout:700ms`, excluding the one-second face poll. `features/poses/actions.ts` polls a preparing catalogue every 700 ms through a raw timeout. Its service had no application signal, the facade did not expose disposal, and startup never disposed it; the loop could keep polling after application release. Sliced host startup can leave it preparing when the page releases. The other 700 ms candidate, preview preparation, already has abort/disposal wiring. Startup now passes its application signal through `createModuleServices` to the pose service. Catalogue reads and waits follow a per-load signal combined with that lifetime; release clears the timer/subscription immediately, a body change cancels the superseded poll, and late replies/publication callbacks cannot schedule another wait. Preference writes retain their existing durability policy. `tests/poses-poll-lifetime.test.ts` exercises the real module composition with fake timers, held replies, synchronous release during publication, supersession, direct disposal, pre-aborted construction and browser transport signal forwarding. `poses-module.test.ts` also requires an already queued preference write to finish after release. The painted browser row remains coordinator-owned.
- **Additional one-second face poll [source/CPU, separate from the reported timer]:** `idle-source.ts`'s `facesKnown()` could poll for ten minutes without a head signal while the body was ready and its face pending. `createHeadRig` now owns a motion-source signal until rig release and passes it through `loadGameMotion`; the source cancels its timer/requests and refuses non-cancellable late replies. Late face binding/publication checks that signal. `tests/idle-source-lifetime.test.ts` removes its timer during sleep, prevents rescheduling after a held reply and rejects pre-aborted calls; `character-detail-context.test.ts` proves rig release aborts motion even with a live parent. This independently reproduced unowned loop is fixed, without claiming it caused the captured 700 ms timer.

**Optional earlier part construction deferred:** a renderer alone is insufficient for the current detail-loader port. `scene-host.ts` creates the character renderer after `createHeadRig` returns; `head-rig.ts` awaits motion, which can replace the eye mesh with its gaze-rig version, then establishes face/morph bindings. The loader's skin/eye/material context uses that completed rig. Splitting its ready/motion lifetimes and restoration policy is more than a cheap promise substitution. The V request/record and warm file fetch/decode already start before motion; actual renderer-part construction retains `await ready`.

## Host contention

**Cause.** Creator presentation and poses repeatedly scan TweakDB value/key tables synchronously. Catalogue construction and text-table merging also run long loops. The facial startup probe builds and solves many control frames together, then derives their displacement fields.

**Change.** TweakDB's existing reader has one shared generator implementation for synchronous and cooperative lookup; cooperative scans hand control back every 1,024 values/keys. Creator presentation and pose catalogue lookup phases use that reader. Creator catalogue construction yields between options and each 256 choices; text merging is chunked. The creator host yields through the existing 8 ms slicer, then waits for the shared scheduler's `person` lane to clear, without holding its running-job slot. Poses use sliced scans too. Facial multi-frame solves and probe frame/displacement construction yield through the same slicer. Output order and interpretation stay the same.

Files (under `projects/xf-studio/authoring/`):

- `src/game/tweakdb-flats.ts`
- `src/character/cc-catalogue.ts`, `src/character/cc-presentation.ts`
- `src/character/host/cc-catalogue-host.ts`, `cc-catalogue-service.ts`, `character-detail-host.ts`
- `src/animation/pose-catalogue.ts`, `src/animation/host/pose-catalogue-host.ts`, `facial-host.ts`

Tests: `cc-catalogue`, `cc-presentation`, `cc-catalogue-service`, `pose-catalogue`, `pose-catalogue-host` and `facial-host` test files. New regressions prove a large option yields within its choices, TweakDB scans admit an event-loop turn before finishing, and cooperative projections equal synchronous answers. Existing facial solver readiness and solve ordering remain covered.

## Request order

**Cause.** The detail service was created after core-head construction, which awaited the idle and blink.

**Change.** The same detail service now starts its request while that construction is in flight. It reads the record immediately and awaits the scene only before loading/preparing renderer parts. Stored destination body visibility and censorship apply before the request. Head preparation joins the initial promise once; newer requests, destination changes, fallback bodies and aborts retain their existing policies. The stored-request warm file reader still starts earlier at page startup, within its existing budgets.

Files: `src/preview/browser/browser-head-attachment.ts`, `src/character/browser/browser-character-detail-device.ts`, and the updated explanatory comment in `src/character/browser/character-warm-start.ts`.

Tests: `browser-head-attachment`, `browser-scene-heads`, `character-detail-context` and `character-detail-pages` test files. New regressions hold construction/motion unresolved and check the V was requested already, preparation joins it, and a delayed scene gets exactly one placement or none after cancellation. Existing destination-close/surviving-sibling regressions remain unchanged.

## Repeated page work

**Cause.** Instance panel subscriptions treated content/progress notifications as controller changes. Each caused the shell's contribution reconciliation to load and save the dock again, rebuilding and measuring every header. Target checks cloned whole tabs to validate IDs. Tab presentation cloned session fragments on each read; starter queries rebuilt outlines; module queries cloned static registration data.

**Change.** Content and local transient updates request the existing frame-coalesced paint; facade replacement and membership/registration changes still reconcile controllers and the dock. Tab strips keep their fit until available length or tab data/selection changes; header tracking leaves unchanged headers alone. Target validation reads internal IDs directly. Tab presentation caches a detached, deeply frozen snapshot until the session changes. Starter projections are reused until their documents or default choice change, while returned editable shapes remain detached. Module descriptors are cloned/frozen once per registration identity. Persistence, autosave and history policy are unchanged.

Files:

- `src/studio-ui/app.ts`, `src/studio-ui/panels/instance-panels.ts`
- `src/studio-ui/components/tab-strip.ts`, `panel-header.ts`
- `src/app/profiles/profile-sessions.ts`, `tab-presentation.ts`
- `src/app/starters/shape-starters.ts`, `src/app/studio-application.ts`

Tests: `profile-instance-controllers`, `profile-sessions`, `profile-sessions-review`, `tab-strip`, `starter-shapes`, `studio-application` and `presentation-read-extensions` test files. New regressions count layout measurements, distinguish content paints from reconciliation, retain snapshot identity across read-only/progress access, invalidate it on rename, and check descriptor/shape mutation isolation.

## First candidate validation (`2e57ae9f`)

**255 tests pass across 17 files**, run in sequential guarded Bun invocations (`--limit 4`): 134 tests across the nine regression-focused files, then 121 across the eight remaining host/session/adapter files named above. Each peaked at 0.6 GB. After passing the creator's scheduler-aware turn through text merging too, its two affected host files passed again (17 tests, 0.4 GB peak). No existing assertion or timing gate was weakened.

Those counts belong to the first candidate, not to the upload-window follow-up.

## Upload-window validation (`da926994`)

**44 tests pass across four files**, in one Bun process under the required 4 GB memory guard (0.3 GB reported peak). The final runtime-only adjustment passed its nine tests again. Files: `link-pacing.test.ts`, `character-preload.test.ts`, `character-renderer.test.ts`, `runtime-preparation.test.ts`. They cover slow statuses, shared requester credit, busy opening fences, window exhaustion/resumption, context loss, oversized fallback admission, fence disposal, actual band/tail costs and both preparation paths. A never-signalling spent window fails at its deadline, sends no extra bands and deletes its fences. Existing morph-round, first-use, supersession and link-cap assertions are retained. The no-draw adapter sends 24 actual `uploadStep` bands with fifteen-frame status latency, checks several bands per frame, the outstanding limit and no sends during the spent window's wait. No existing assertion or timing gate was weakened.

Those counts describe the committed upload window. Current correction test/check results are recorded at wrap-up below.

## Correction validation

Targeted CPU checks cover the upload budget and its call sites, morphs, pose projection/header fitting, pose polling and idle-source lifetime. No existing browser assertion or timing budget is changed. The pre-existing generated style-guide change from the coordinator's gate run is outside this correction and is left untouched. No scratch payloads or retained test logs are created.

**122 targeted tests pass across 13 files**, one Bun process under the required 4 GB guard (0.3 GB reported peak). Files: `gpu-upload-work`, `link-pacing`, `character-preload`, `character-renderer`, `runtime-preparation`, `morph-textures`, `pose-catalogue`, `tab-strip`, `idle-source-lifetime`, `character-detail-context`, `idle-body`, `poses-poll-lifetime`, `poses-module` (`tests/*.test.ts`). The original no-draw throughput assertions remain unchanged. The coordinator owns typecheck and the two browser resource rows; their earlier failures are not labelled passes from CPU evidence.

Checks: zero broken links/source paths in 508 Markdown files; zero tracked private-path findings. The additional privacy/whitespace scan of all 28 changed/new files (including the pre-existing guide change) reports zero findings. The footprint report shows **292.0 GB free on C** and this worktree below its 0.5 GB reporting threshold. No task-owned child process or scratch payload remains; existing coordinator measurements stay in their scratch folder.

## Limits

The coordinator still owns browser timing, broad/type/desktop gates and independent review. The 64 MiB RGBA8 window is an implementation bound, not a measured driver-capacity guarantee; the opening barrier and spent-window backpressure are CPU-tested, but G2 protection under a genuinely busy GPU process and the best window size still need the coordinator's measurement. The code retains synchronous bounded resource parses, individual facial solves, relation analysis and GPU texture work; this task does not claim that every task is below 50 ms or that the 2 s budget is met. No game or mod-manager operation is needed for this checkpoint.

**Knowledge used:** [WebGL linking/uploads](../../knowledge/webgl-program-linking.md), [mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction), [body animation](../../knowledge/body-animation.md), [poses](../../knowledge/poses.md), [facial animation](../../knowledge/facial-animation.md), [knowledge rules](../../knowledge/README.md). WebGL/mod-loading now record the measured window result and its incomplete opening-only protection, corrected submission/lifetime policy, the 700 ms pose poll's missing application lifetime and evidence limits.
