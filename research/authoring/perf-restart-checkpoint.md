# PREV-196: warm restart preparation

Candidate based on `f37aaa53`, 29 October 2026. Changes are uncommitted for coordinator review. This is an offline implementation checkpoint; the **<2 s warm restart budget is still open** until the coordinator measures the candidate.

## Baseline and measurement handoff

The coordinator's `tools/measure-warm-restart.ts` baseline used an isolated server, the default V, and kept caches and Chrome profile; runs 2–4 were warm. The complete V appeared at **10.3–10.5 s from page start**, superseding the earlier 2.8–3.0 s result. One warm timeline, in milliseconds:

```text
ask 5814 → answer 5945 → record 5976 → loaded 6119 → prepared 10429 → placed 10435 → frame 10464
```

The kept host answer was checked in 117 ms. Creator options occupied the host for about 3.9 s, delaying blink/facial/idle answers; the V's ordinary request followed those answers. The loaded-to-prepared interval consumed another 4.3 s on the page. The page profile shows repeated dock loads and tab-header layout reads, tab/scene clones, starter projections and module descriptor clones.

**After marks: pending coordinator measurement.** Run the same kept-cache/profile setup after first priming the candidate: source changes invalidate kept host answers by design. Compare warm runs' full timelines, request intervals, host responsiveness and the page's loaded-to-prepared interval. Include a saved V and stored body/uncensored settings when checking correctness. No Chrome, browser gate, latency gate, 038 harness, desktop test, suite batch or typecheck ran in this task.

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

## Targeted validation

**255 tests pass across 17 files**, run in sequential guarded Bun invocations (`--limit 4`): 134 tests across the nine regression-focused files, then 121 across the eight remaining host/session/adapter files named above. Each peaked at 0.6 GB. After passing the creator's scheduler-aware turn through text merging too, its two affected host files passed again (17 tests, 0.4 GB peak). No existing assertion or timing gate was weakened.

Repository checks: zero broken links/source paths in 507 tracked Markdown files; zero private-path findings; `git diff --check` and a Python whitespace scan passed across every changed/new file. The new untracked checkpoint was checked separately with the same link/source-path and privacy helpers. The footprint report found 285.1 GB free on C; this worktree is below its 0.5 GB listing threshold, and the task keeps no large outputs. Temporary test logs are removed. The coordinator owns the broad gates and candidate measurement.

## Limits

The coordinator still owns browser timing, broad/type/desktop gates and independent review. The code retains synchronous bounded resource parses, individual facial solves, relation analysis and GPU texture work; this task does not claim that every task is below 50 ms or that the 2 s budget is met. New measurements must identify the next remaining cost. No game or mod-manager operation is needed for this checkpoint.

**Knowledge used:** [mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction), [poses](../../knowledge/poses.md), [facial animation](../../knowledge/facial-animation.md), [knowledge rules](../../knowledge/README.md). Mod loading's old current warm timing was incomplete and is updated with the coordinator baseline and the candidate's evidence limits.
