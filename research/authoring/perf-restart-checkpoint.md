# PREV-196: warm restart preparation

The first candidate, `2e57ae9f` based on `f37aaa53`, regressed warm restart time. The upload-window follow-up is uncommitted for coordinator review (29 October 2026). The **<2 s warm restart budget is still open**; no browser timing is claimed for this follow-up.

## Baseline and measurement handoff

The coordinator's `tools/measure-warm-restart.ts` baseline used an isolated server, the default V, and kept caches and Chrome profile; runs 2–4 were warm. The complete V appeared at **10.3–10.5 s from page start**, superseding the earlier 2.8–3.0 s result. One warm timeline, in milliseconds:

```text
ask 5814 → answer 5945 → record 5976 → loaded 6119 → prepared 10429 → placed 10435 → frame 10464
```

The kept host answer was checked in 117 ms. Creator options occupied the host for about 3.9 s, delaying blink/facial/idle answers; the V's ordinary request followed those answers. The loaded-to-prepared interval consumed another 4.3 s on the page. The page profile shows repeated dock loads and tab-header layout reads, tab/scene clones, starter projections and module descriptor clones.

**Measured first candidate:** back-to-back on the same machine/load, with the game running at about 45% GPU throughout both versions, main `f37aaa53` drew the V at **9.9 / 10.6 s** (loaded at 5.8 s). Candidate `2e57ae9f` drew it at **20.3 / 20.7 / 20.3 s**: asked at 1.0 s, loaded at 4.1–5.5 s, `details:uploads` at 18.2 s. Preparation took about 15 s with the page about 85% idle and rAF steady at 60 Hz. Earlier request/loading improved; total time regressed.

**Follow-up marks: pending coordinator measurement.** Prime source-invalidated kept answers, then compare the same warm setup. Capture the upload calls' durations as well as fence/texel counts, `details:uploads`, prepared and full frame; check that the window avoids the G2 busy-process upload stall as well as improving quiet-context throughput. Include saved V/body/uncensored correctness. No Chrome, browser gate, latency gate, 038 harness, desktop test, suite batch or typecheck ran in this follow-up.

## Upload fences: the measured regression and follow-up

**Observed:** the coordinator's WebGL2 prototype wrapper found no draws during preparation in either build. Main sent 25–46 fences/s, 48–116 unsignalled polls/s and 23–43 `texSubImage2D` calls/s; uploads finished about 3 s after loaded. Candidate sent only 3–6 fences/s and 3–5 uploads/s for about 14 s while polling about 120 times/s. Chrome's own 3D-engine use stayed at 1–2%; a fence took 200–250 ms to report signalled. The prior [quiet-context probe](../../knowledge/webgl-program-linking.md#8-a-second-runtime-of-one-v-what-it-costs-and-what-it-shares) also found 230–290 ms status delays. The explanation that former shell repaints kept Chrome's GPU channel active remains a **hypothesis**, not a verified Chrome mechanism.

**Verified amplification [source + offline CPU tests]:** `upload()` marked after every band/storage allocation, and both `uploadAll` and `streamUploads` required that fence to pass before the next step. Runtime preparation did the same. Thus each late status serialised another band, even when no GPU work was busy. A no-draw fake reporting completion fifteen frames late reproduces 24 bands taking 345 frames with the former gate pattern; the new window takes 45 frames, including its opening wait. This verifies the serial-wait mechanism, not the browser's reason for delayed reporting.

**Design:** one reference-counted upload window per renderer, shared by streaming, detail preparation and runtime preparation. Admission accounts for the next whole upload or actual band (including a short tail), with one credit for storage allocation. At most **16,777,216 texels** remain outstanding (64 MiB for RGBA8). An opening fence waits for preceding GPU-process work before the first burst. Turns checkpoint their combined uploads before yielding, at completion or when the window fills. Several bands/frames can proceed within that window; a full window sends nothing until a checkpoint reports completion. Only that checkpoint's credit is returned, with no timed release or extra draws. Explicit upload waits fail closed after 120 frames; optional streaming stops polling after 120 turns without progress and leaves eventual preparation/error policy to its requester. The 8 ms CPU share remains. An existing indivisible fallback larger than the window goes alone after all previous credit completes; ordinary decoded large maps still use 512-row bands. Context loss discards the generation's fences/credit and requires a new opening checkpoint; the last requester deletes live fences.

`gpuDrained` remains a true barrier before bakes and synchronous program first uses. Runtime maps finish before morph uploads and before warm-up consumes them; morph memory fills can continue meanwhile. Morph uploads already batch a round behind one fence and retain their Float32 upload barrier. Warm-up barriers remain because a draw can build costly shader variants: permitting another draw before completion would remove their protection. The link pacer already admits 2–6 concurrent links and waits only when full using actual `COMPLETION_STATUS_KHR`, so it is unchanged. None of those waits is repeated for each map band now.

**Files** (under `projects/xf-studio/authoring/`): new `src/platform/scene/gpu-upload-budget.ts`; `src/platform/scene/character-renderer.ts`, `runtime-preparation.ts`, `gpu-gate.ts`; next-step accounting in `src/character/render/character-detail-loader.ts`. Tests: `tests/link-pacing.test.ts`, `character-preload.test.ts`, `character-renderer.test.ts`, `runtime-preparation.test.ts`, with `tests/fixtures/slow-upload-renderer.ts`.

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

## Follow-up validation

**44 tests pass across four files**, in one Bun process under the required 4 GB memory guard (0.3 GB reported peak). The final runtime-only adjustment passed its nine tests again. Files: `link-pacing.test.ts`, `character-preload.test.ts`, `character-renderer.test.ts`, `runtime-preparation.test.ts`. They cover slow statuses, shared requester credit, busy opening fences, window exhaustion/resumption, context loss, oversized fallback admission, fence disposal, actual band/tail costs and both preparation paths. A never-signalling spent window fails at its deadline, sends no extra bands and deletes its fences. Existing morph-round, first-use, supersession and link-cap assertions are retained. The no-draw adapter sends 24 actual `uploadStep` bands with fifteen-frame status latency, checks several bands per frame, the outstanding limit and no sends during the spent window's wait. No existing assertion or timing gate was weakened.

Checks: zero broken links/source paths in 508 Markdown files, zero tracked private-path findings; untracked source/fixture privacy and changed-file whitespace are checked separately. The footprint report found **284.4 GB free on C**; this worktree is below its 0.5 GB listing threshold. This follow-up creates no scratch payloads or retained test logs and leaves no child process running. The coordinator's existing measurement scratch remains theirs.

## Limits

The coordinator still owns browser timing, broad/type/desktop gates and independent review. The 64 MiB RGBA8 window is an implementation bound, not a measured driver-capacity guarantee; the opening barrier and spent-window backpressure are CPU-tested, but G2 protection under a genuinely busy GPU process and the best window size still need the coordinator's measurement. The code retains synchronous bounded resource parses, individual facial solves, relation analysis and GPU texture work; this task does not claim that every task is below 50 ms or that the 2 s budget is met. No game or mod-manager operation is needed for this checkpoint.

**Knowledge used:** [WebGL linking/uploads](../../knowledge/webgl-program-linking.md), [mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction), [poses](../../knowledge/poses.md), [facial animation](../../knowledge/facial-animation.md), [knowledge rules](../../knowledge/README.md). The per-band policy in WebGL §4 and mod loading's pending candidate timing were incomplete; both are updated with the measured regression, bounded-window implementation and evidence limits.
