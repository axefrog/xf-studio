# CORE-03 slice 13c1 report

Implemented **13c1 only**, from `6ad0552b`, committed by the coordinator as `cd4db4c6`. The durability review corrections below are uncommitted. CORE-03 remains **High**. The coordinator approved splitting the original 13c after the read-only audit estimated 2–3 agent-days: 13c1 existing-owner/workspace/bootstrap/diagnostics cleanup; 13c2 leases/outbox/detached captures; 13c3 shell/facial/warm-start cancellation and integrated browser proof. The plan now has 18 checkpoints, 15 implemented and three remaining (13c2, 13c3, 13d).

## Changed files and release ownership

Paths below are relative to `projects/xf-studio/authoring/` unless stated otherwise.

| File | Change and what releases |
|---|---|
| `src/compose/studio-startup.ts` | Connects existing shell, head, profile, facial, host preparation and WolvenKit cleanup to the root signal. Shell consumers withdraw before heads, the viewport device and the shared editor, with `finally` preserving subsequent cleanup. Releases root-owned framework-watch, outbox-status, lease-observer, transition, application, quality, session and preview-setup subscriptions; retires early migration persistence and stops quiet prefetch. Startup pagehide/visibility/focus listeners use the lifetime. Pagehide, explicit abort and upstream abort synchronously settle edits and flush the workspace before publishing abort or disposing capture sources; a refused save keeps the lifetime alive for retry. Explicit cancellation cannot become a startup error notice; actual startup failure renders its error before aborting. Root adapter-message, drawn-view, shown-head and host-flush callbacks refuse work after abort. |
| `src/app/browser/browser-workspace-device.ts` | Optional signal calls release: flush the existing persistence owner, then retire its debounce, five browser triggers (one window, four document) and status/content subscriptions. Later `watch()` calls attach nothing; individual watch release is idempotent. `release()` refuses retirement if the save fails. `retire()` is cleanup for a confirmed lease handover whose final save already succeeded; already-aborted construction is inert. |
| `src/app/trusted-studio-bootstrap.ts` | Abort calls the existing file/collection cleanup, alongside aborting presentation/module lifetime. Failed construction unwinds both services; file cleanup cannot prevent collection cleanup. An already-aborted input is rejected before construction. Existing instance retirement versus accepted-work ownership policy is retained. |
| `src/diagnostics/browser/browser-device.ts` | Owns report/read cancellation, flush/rate-limit timers, page error/rejection/pagehide hooks and the fetch observer. Restores its fetch wrapper without overwriting a newer wrapper and refuses late host references, downloads and issue-page continuation. Accepted log batches use uncancelled keepalive delivery: queued batches are handed off synchronously, existing deliveries survive, and refused handoffs remain retained. It does not cancel other owners' fetches. The existing GPU probe still releases its temporary context immediately. |
| `src/diagnostics/actions.ts` | Optional signal withdraws service listeners/view-state callbacks, stops report-progress waits and refuses later actions/publications. Late preparation, mode, full-item and bundle answers cannot change its snapshot or save a file. Normal report/review behavior remains covered by the existing diagnostics tests. |
| `src/diagnostics/page-sink.ts` | A signal withdraws only its own installed sink; aborting an older owner cannot withdraw a newer sink. |
| `src/preview/browser/browser-viewport-device.ts` | Adds idempotent device disposal after the head owner releases runtimes: editor, prepared surface resources, context subscribers and the shared renderer/context. Refuses construction after disposal. Startup also supplies its existing input-listener signal. The real renderer device already owns Three disposal, context loss and canvas removal. |
| `tests/workspace-lifetime.test.ts` (new) | Six cases: explicit abort/release, native pagehide checkpoints, upstream abort, already-aborted construction and save-refusal/retry. Checks restored dirty layout/preferences/preview state, source lifetime and no later writes. |
| `tests/diagnostics-lifetime.test.ts` (new) | Eleven cases: request/hook release with durable log handoff; rate-limit tail/pre-aborted owner; synchronous queued/in-flight handoffs and retained failures; late prepare/bundle/mode/item replies; sink ownership; abort during busy publication before a device step starts. The transport deliberately ignores cancellation to test stale continuation refusal. |
| `tests/trusted-studio-bootstrap.test.ts` | Two new cases prove source-subscription/file-destination release on abort and on partial construction failure; also reject pre-aborted construction. |
| `tests/browser-viewport-device.test.ts` | One new CPU stand-in proves shared-device release exactly once after runtime release, input withdrawal and refusal to rebuild. This measures ownership/order, not real GPU counts. |
| `tests/core-startup-release.test.ts` (new review regression) | Calls the real startup, fails after diagnostics installation and proves that its displayed reference is in an uncancelled keepalive log POST. |
| Repository records | `research/authoring/core-03-plan.md`, `code-health.md`, `ui-architecture-boundary.md`, this report and `research/backlog/README.md` record the bounded scope and remaining gates. `knowledge/webgl-program-linking.md` distinguishes runtime release from shared-device release, with source/CPU evidence and explicit GPU limits. |

The root now invokes existing facial timer/listener disposal and head residency cleanup; facial transport and warm-start cancellation remain 13c3. Profile context disposal retains its existing dirty-write/retry policy. Lease release hooks, lease transports, outbox stop/durability ordering and detached accepted-work lifetimes remain 13c2. This checkpoint does **not** claim complete startup resource release or count-baseline proof.

## UI, bound panels and captures

**Studio-ui lifecycle edits: none.** No component, style guide, markup, styling or shell API source changes. Startup calls the shell's existing disposer; its incomplete global-listener/frame/observer cleanup is 13c3.

Bound-panel release changes are limited to root shell withdrawal and bootstrap abort invoking its existing file/collection disposal, including each child bootstrap's existing lifetime. `PanelEditingContexts`, capture transfer, accepted-operation policy, `retireFiles` semantics and P3-v contribution/instance catalogue implementations are untouched. Application-wide bounding of detached captures remains 13c2. `panels.bindings`, `panels.setBinding`, `authoring.historyScopes()` and `history.selectScope` remain unchanged.

The empty-composition UV status leak is owned by `studio-ui/app.ts`'s `statusBar`, which calls `readinessText`; that helper always interprets generated makeup size and falls back to “UV map”. Per the coordinator's decision, 13d will move this readiness presentation into a feature contribution, with a narrow additional UI permission and identical normal output. This checkpoint leaves it unchanged.

## Original checkpoint gates

All Bun commands ran **one at a time**, under the full-path Python memory guard with a 4 GB limit. No quiet window was relayed. No check, suite batches, desktop gates, 038 harness, style-guide build or latency gate ran. Typechecking remains with the coordinator; relevant signatures were read manually, including optional signals, nullable diagnostics failure references, fetch's Bun namespace versus a local function, texture-size literals and viewport factory disposal.

| Gate | Result |
|---|---|
| Pre-production-edit baseline | **19 pass, 0 fail**, 5 files, 1 snapshot, 137 assertions, 9.59 s; peak **1.0 GB**. Diagnostics review/queue, workspace persistence/device behavior, bootstrap and frozen startup parity. |
| First new owner regressions | **11 pass, 3 fail**, 3 files, 96 assertions, 0.236 s; peak rounded **0.0 GB**. Two failures exposed shared callback identity in the new workspace watch implementation; fixed by giving each subscription its own callback. One test injected failure through the wrong module property; corrected to the actual construction seam. |
| Affected correction | **7 pass, 0 fail**, 2 files, 59 assertions, 0.176 s; **0.0 GB**. Workspace and bootstrap files only. |
| Focused owner and boundary checks | **71 pass, 0 fail**, 6 files, 692 assertions, 16.57 s; peak **0.4 GB**. Includes diagnostics behavior/lifetime, viewport, architecture-import-boundary, trusted-studio-bootstrap and view-contributions. |
| Final targeted/parity/startup run | **94 pass, 3 skip, 0 fail**, 17 files, **17 matching snapshots**, 984 assertions, 12.89 s; peak **0.6 GB**. All 13 owner regressions then present pass. No expected snapshot was updated. |
| Final diagnostics guard follow-up | **8 pass, 0 fail**, 1 file, 48 assertions, 0.031 s; peak rounded **0.0 GB**. Abort from a busy-state subscriber now refuses the device step before it starts. All eight diagnostics lifetime cases pass after the one-line guard; unchanged snapshot paths were not needlessly rerun. |
| Unique executed coverage | **111 pass, 3 skip, 0 unresolved fail across 20 files**. The final run overlaps earlier checks; add only the 16 baseline diagnostics/workspace/device passes absent from it and the final new busy-publication case. All 14 new owner regressions pass. No full-suite result is claimed. |
| Repository checks | **0 broken links/source paths across 502 tracked Markdown files; 0 tracked-text private-path findings; 0 privacy/trailing-whitespace/source-path findings in all 3 new files; clean `git diff --check`.** |

The three skips are the optional six-private-raster reference case and the two Chrome normal/empty startup cases. Chrome was marked unavailable only in the test process; skips are not passes. No memory floor/limit kill occurred. The existing browser test still fails when Chrome is absent under `XFS_REQUIRE_ORACLES=1`.

## Parity and compatibility evidence

The existing snapshots are byte-unchanged in Git. SHA-256 below normalizes CRLF to LF, matching the baseline reports. The pre-edit run already matched startup parity on unchanged `6ad0552b` production; final tests match all eight retained CORE-03 snapshot files without updating them.

| Snapshot | SHA-256 (LF) | Covers |
|---|---|---|
| `core-startup-parity.test.ts.snap` | `38072be50b2cf4d466af6bada1b57629357a50e03999347db9ecf932e1e4c2c9` | Registry/actions/product/module data; contributions/catalogue/binding IDs; renderer/surface/face-poser lists; layouts, workspace, migration/session and starter defaults. |
| `core-product-parity.test.ts.snap` | `97afc5de336b0760c6699f4f904e1052f6ed91cb5d4440fb6e40472b2eef29ec` | Document/history/geometry, captured identities, keyed sharing and A/B/A refusal. |
| `core-file-export-parity.test.ts.snap` | `91776acef45b7c0cf506c7e213c6bb3c1585727f41442a0fb3532d8f5612a795` | Released portable bytes/names/refusals, collection/compiler plans, Check/Build inputs and omissions. |
| `core-viewport-parity.test.ts.snap` | `053a596936ce05af98fd1c0b9ac81233fd89152d9a0e8c0bb3bfc511b39d226b` | Bound UV navigation/selection, independent gesture commit/Escape and release. |
| `core-preview-parity.test.ts.snap` | `d08aafdc22af193b07683329670dd8bdc6cd0fc0b81adc60eaec9e0f298ed342` | Preparation outputs/cache identities, worker bytes, publication, warm holds and supersession. |
| `core-context-parity.test.ts.snap` | `ce159a33b48fc3cd9639135b4524525746a2225589ad3f3b50719a00d76e2814` | Menu/popover data, hints, cursor and markup. |
| `core-guidance-parity.test.ts.snap` | `4d946713a250079eeed320adfddfb315c979b0ff462eca24651bb99bed6379ec` | Help/tour text, anchors, controller and onboarding behavior. |
| `core-placement-parity.test.ts.snap` | `27bb854c975e26d588d5cf6c3e92acea3b11ab3bd0a42ac25a024ca6058baa1d` | Product/framework/install defaults, identities and wording. |

The final real mask-worker regression also retained the three corrected 2048 RGBA hashes recorded in slice 11. No pipeline/compiler/manifest format, import allowance, binding/history API or normal catalogue changed.

## Coordinator browser and GPU checks

From `projects/xf-studio/authoring`, with `CHROME` naming a real Chrome executable:

```powershell
$env:XFS_REQUIRE_ORACLES = '1'
& "$env:LOCALAPPDATA/Python/pythoncore-3.14-64/python.exe" ../../../tools/memory_guard.py --limit 4 -- bun test --timeout 180000 tests/core-startup-browser.test.ts
```

This is the **existing mount/paint test**, using the CDP harness, disposable host/browser state and a transient port. It is not the future resource-baseline proof. The coordinator explicitly assigned that normal/empty/partial-start test to **13c3**; no substitute browser proof was added in 13c1. No maintained port, game or MO2 was touched.

Most directly affected WebGL rows: **renderer-device** shared canvas/context disposal and rehost; **scene-dispose** and **scene-runtimes** resident/warm teardown, cancellation, late completion and context restoration. **Choice-preview** worker/context admission can be affected through head-context release. Existing plate-composite/scene-host preparation and warm A/B/A rows protect unchanged surface/raster ownership. Run the standard WebGL set, both dock-strip geometry files, tree-view geometry and layout-tabs timing in the coordinator's shell; none ran here.

Manual checks in isolated `?verify=1`, for both normal and empty composition:

- Compare light/dark, narrow/wide startup and restored arrangements; normal UV/makeup/starter output and saved binding/history identities should match. The known empty-shell UV status remains until 13d.
- Restore a draft, edit it, hide/reload immediately and confirm existing pagehide saves survive. Exercise same-look and differently bound panels, A/B/A, scoped Undo, menus and open captures, close/reopen/rehost and reload.
- Prepare/open a diagnostics report, see progress, review/copy/save it, and confirm normal failure references and mode changes. Exercise abort only in a disposable verification page. Complete global resource counts and absence of all late shell/facial/warm-start callbacks are still 13c3 gates.

Independent code review, authoring/desktop typechecks and the withheld heavy gates remain coordinator-owned. No new visual PASS, browser, GPU or game result is claimed.

## Remaining work

- **13c2:** stop APIs for localhost/desktop leases, Web Lock/channel/stream release, application-bounded detached captures/accepted work, and tested outbox durability ordering. Preserve pending writes before release and refuse late writes without silent loss.
- **13c3:** complete root-signal shell cleanup, facial/warm-start transport and timer cancellation, and real CDP live-resource baseline, late-publication and partial-start proof without destroying the page.
- **13d:** mounted synthetic panel/editor/Undo/file substitution, mechanically enumerated feature/composition-only integration, UV-status feature contribution and retained-consumer closure, plus all required coordinator browser/GPU results.

## Durability review corrections (29 October 2026)

Both reported data-loss findings are corrected. The workspace adapter owns a synchronous pre-release save phase, used by real startup before the lifetime signal aborts. Startup settles/commits existing look owners, then calls session release while capture sources remain live. The release adapter flushes before retirement, returns false on a refused save and preserves its sources for retry. No microtask ordering assumption remains. Confirmed lease handover retains its existing separate flush-then-retire protocol.

Diagnostics separates accepted log delivery from report/read cancellation. Closing stops admission and timers, hands every waiting batch to keepalive fetch synchronously (including alongside an already in-flight batch), and never attaches the abort signal to log POSTs. Refused handoffs retain the entire finite accepted tail instead of truncating or emptying it. Normal admission bounds, host limits and malformed-batch policy are unchanged; no new persistent log format or unbounded retry loop is introduced. Reports/reads still cancel and cannot publish late results.

Follow-up production files are only `src/app/browser/browser-workspace-device.ts`, `src/compose/studio-startup.ts` and `src/diagnostics/browser/browser-device.ts`. The two lifetime test files are corrected and `tests/core-startup-release.test.ts` is new. Records updated: this report, the plan, code-health ledger, UI boundary, `knowledge/webgl-program-linking.md` and `docs/diagnostics.md`. **No studio-ui lifecycle edit or bound-panel/capture release change**; binding/history APIs and renderer algorithms remain unchanged.

| Review gate | Result |
|---|---|
| Focused durability regressions and existing diagnostics behavior | **26 pass, 0 fail across 4 files**, 170 assertions, 2.14 s; guard peak **0.4 GB**. |
| Final targeted boundary/parity/startup run | **108 pass, 3 skip, 0 fail across 18 files**, **17 matching snapshots**, 1,071 assertions, 13.54 s; guard peak **0.6 GB**. Includes those four files, architecture-import-boundary, trusted-studio-bootstrap, view-contributions, all eight CORE-03 parity files and startup composition/paint/browser. |
| Repository checks | **0 broken links/source paths across 503 tracked Markdown files; 0 tracked-text privacy findings; 0 privacy/source-path/whitespace findings in the new test; clean `git diff --check`.** All eight retained snapshot hashes above reverified; no snapshot changed. |

The final run includes all focused cases; counts are not additive. Regressions cover native callback microtask checkpoints; pending layout/theme/texture-size restoration; explicit/upstream release and refused-save retry; queued and in-flight log handoff, retained 400/503 responses, and the real startup-failure reference. The three skips remain the optional private-raster case and the two Chrome tests. Each Bun run used the 4 GB guard, one process at a time. No heavy gate, typecheck, browser, GPU or game run occurred; no guard kill occurred.

The browser command and WebGL rows above remain coordinator-owned. For these corrections, immediately reload after changing layout/theme/preview quality inside the 180 ms debounce, and repeat using `window.xfStudioLifetime.abort()` before reload in a disposable `?verify=1` page. Confirm the latest state restores. Trigger a controlled startup failure and verify the displayed reference exists in the host log; closing with queued/in-flight diagnostics must leave their POSTs uncancelled. Complete CDP resource baselines remain 13c3; the listed 13c2/13d scope is unchanged.

Follow-up wrap-up footprint: **200.9 GB free on C**, measured with `tools/disk_footprint.py` under the 1 GB guard (peak rounded to **0.0 GB**). No task payload above 5 GB, capture or log is retained. Tests swept their scratch files; sandbox policy rejected deletion of the remaining **empty** directory `projects/xf-studio/authoring/local/core-03-release-fix`. That is the sole cleanup item. All owned jobs ended; no commit, push, subagent or maintained-server operation occurred. The follow-up changes remain uncommitted in **12 files**.

## Original checkpoint footprint

Repository checks passed: 0 broken links/source paths across 502 tracked Markdown files, 0 tracked-text privacy findings, 0 privacy/whitespace/source findings in all three new files, and clean `git diff --check`. The checkpoint footprint had **206.2 GB free on C**, and wrap-up had **205.5 GB**; each report ran under the 1 GB guard with peak rounded to 0.0 GB. No task payload above 5 GB or cleanup-blocked path is retained. No task scratch script, log or capture was retained; inline task scripts wrote only worktree source/records. Existing test helpers sweep their temporary folders. There are **17 changed/new files**. No subagents were started, no commit or push was made, and all owned guarded jobs ended.

**Knowledge used:** knowledge index and WebGL program linking (updated with source/CPU ownership-order evidence and GPU limits); CORE-03 plan/as-built notes and 13a/13b reports; architecture contract, UI architecture boundary, view-graph design, developer orientation/test helpers and project status/backlog/README context. No game-engine knowledge page was contradicted; complete mounted-release evidence remains explicitly incomplete.
