# CORE-03 slice 13c3 report

Implemented from `73de0a0d`, left **uncommitted** for coordinator review. CORE-03 remains **High**. CPU validation passes; the required integrated browser/GPU result is pending. No 13d implementation is included.

## Owners and release order

The 13c1/13c2 order is unchanged: settle/commit edits → protect pending outbox recovery → workspace permits retirement → synchronous consumer teardown → durable host handoff → lease stop. Failed protection or a refused workspace save retains recovery and the lease. Accepted diagnostics keepalive delivery and already accepted durable writes retain their existing separate lifetimes.

Within consumer teardown, the shell withdraws before heads, the viewport renderer/context and the profile editing owner. Its child signal removes global handlers, closes menus/popovers, stops feedback and queued work, disposes panel/view controllers and observers, and removes only its own captured DOM nodes (never a replacement startup-error notice). Hosted pagehide no longer has an independent shell retirement path: the application alone decides whether release is permitted. Existing detached captures still receive the application signal separately from the shell child signal.

Facial disposal marks the owner stopped, aborts its transport signal, clears poll/slow/animation timers, then drops listeners and the scene sink. Warm release aborts metadata, clears expiry, cancels untaken file jobs and releases their decoded results. Taking a file transfers its existing promise/lifetime out of the warm maps; ordinary expiry preserves that live loader, while application abort still cancels it. Browser bitmap/GLTF decoding cannot always be interrupted: cancellation checks discard late results, close bitmaps and release parsed objects. Update-check quiet waits/requests also end at application abort and cannot publish a late answer.

## Changed files

Paths in the tables are under `projects/xf-studio/authoring/` unless stated otherwise. All shell edits are lifecycle-only; normal markup, styling, control semantics and style-guide sources are unchanged.

| Production files | Exact change |
|---|---|
| `src/compose/studio-startup.ts` | Pass the existing root signal to warm start and the update-check device. No new startup policy or composition selection. |
| `src/animation/facial-preview.ts` | Owner signal on state/expression/prefetch/solve requests; stop/retry/subscription/late-answer guards; timers and sink released. |
| `src/animation/browser/browser-facial-device.ts` | Forward optional signals to HTTP and check after response/body before float decoding. URLs, request bodies and page-client identity remain the same. |
| `src/character/browser/character-warm-start.ts` | Cancellable expiry, metadata and per-file read/decode jobs in the existing maps; taken-file transfer survives ordinary expiry; no remembered-request write after root abort. |
| `src/character/render/character-detail-loader.ts` | Optional cancellation at geometry task boundaries, record/body and texture decode boundaries; clear pending geometry task timers and release late parsed objects/bitmaps. Normal parsing, hashing and pixels are unchanged. |
| `src/setup/update-check-actions.ts`, `src/setup/browser/browser-update-check-device.ts` | Root-bounded quiet wait/HTTP dispatch and no late state publication, using the existing clock/transport. |
| `src/studio-ui/app.ts` | Internal child lifetime; signal-bound global page/visibility/resize/context/key/theme handlers; tracked paint/help/settings/recovery frames; heavy/resize timer cleanup; immediate per-owner cleanup registration; owned DOM withdrawal; preserve application authority over pagehide and capture lifetimes. No catalogue edits. |
| `src/studio-ui/runtime.ts` | Refuse subscription/changed notifications after application abort. Existing accepted file/library feedback policy is unchanged. |
| `src/studio-ui/feedback.ts` | Track/cancel every announcement frame, fade/removal timer; refuse late toasts, activity, announcements and retained toast actions. |
| `src/studio-ui/help-tip.ts`, `src/studio-ui/reason-tip.ts` | Signal-bound document handlers; remove owned bubbles, clear reason-tip linger timer and reset installation state for remount. |
| `src/studio-ui/guidance/controller.ts` | Signal-bound Escape, focus frames and pending command run; no post-abort tour records, offers or updates. |
| `src/studio-ui/guidance/overlay.ts` | Signal-bound shared input-origin handlers and callout keys; stop spotlight frame loop and discard active state. |
| `src/studio-ui/header-fit.ts` | Disconnect observer and refuse late font-ready refits. |
| `src/studio-ui/dock/dock-view.ts` | Track/cancel focus frames; use the existing signal cleanup for observer/scroll/input teardown; refuse late render/update/reveal/open-view. |
| `src/studio-ui/layout-tabs.ts` | Signal-owned disposal; disconnect resize observer/subscription; cancel active drag's document handlers and delayed click reset. |
| `src/studio-ui/menu.ts` | Blur listener belongs to the open menu, alongside outside-click removal; menu/popover close cancels pending focus frames and outside-listener timers. |
| `src/studio-ui/view-state.ts` | Preference-backed view memory refuses writes after its shell signal aborts, including scroll-memory teardown. |
| `src/studio-ui/components/choice-preview.ts` | **Component lifecycle edit:** the shell releases the existing lazily installed shared SVG filter/observer. Normal installation/markup is unchanged. |
| `src/studio-ui/components/direction-dial.ts` | **Component lifecycle edit:** optional lifetime removes existing input/drag handlers, disconnects resize observer, clears key-burst timer and drops active transient drag state. |
| `src/studio-ui/panels/preview.ts` | Pass the existing instance/application signal to the direction dial. No lighting behaviour/control change. |

No style-guide edit. Optional internal lifecycle arguments do not add a public presentation capability, action or registry. `panels.bindings`, `panels.setBinding`, `authoring.historyScopes()`, `history.selectScope` and P3-v contribution/instance catalogue implementations and IDs are unchanged. Feature-core/exporter allowances remain **3/11**. No storage schema, package/compiler/manifest/promotion or mod-pipeline change.

**Bound panels and captures:** neither implementation is edited. The shell now invokes their existing disposal through its child signal, while `StudioRuntime.applicationSignal` retains the original root lifetime. Normal menu dismissal still transfers accepted work; actual application abort releases it. A refused pagehide save cannot independently abort the hosted shell. Real accepted-work, controller/capture, workspace-refusal and unchanged public-port tests pass.

| Test files | Evidence/change |
|---|---|
| `tests/facial-lifetime.test.ts` | Seven owner/HTTP cases: state, installed expressions, prefetch, solve and late response bodies; timers/sink/publication refusal. |
| `tests/warm-start-lifetime.test.ts` | Six cases: late metadata/record, pre-aborted construction, taken decode under application abort, ordinary expiry and expiry followed by application abort. A late bitmap closes exactly once. |
| `tests/shell-lifetime.test.ts` | Six cases: timers/frames and retained feedback actions; tip removal/remount; font-ready/input-origin/preferences; menu handlers; update quiet wait and late transport. |
| `tests/core-startup-resources.test.ts`, `tests/fixtures/startup-resources.ts` | Four required Chrome rows plus two CPU instrumentation checks, including deliberate leaks/removal. |
| `tests/core-startup-browser.test.ts`, `tests/fixtures/startup-shell-paint.ts` | Move the existing independent pixel/geometry/control paint gate unchanged into a shared fixture; both browser suites reuse it, including transparent-shell rejection. |
| `tests/character-panel-dom.test.ts`, `tests/layout-tabs.test.ts`, `tests/menu-position.test.ts`, `tests/presets-conflict-dom.test.ts`, `tests/starter-shapes.test.ts`, `tests/ui-polish-dom.test.ts` | Complete existing window mocks with `removeEventListener`; behavioural assertions are unchanged. |

Repository records: this report, [plan](core-03-plan.md), [CORE-03 ledger](code-health.md), [UI boundary](ui-architecture-boundary.md) and [WebGL ownership knowledge](../../knowledge/webgl-program-linking.md). No shared backlog/product-status change is needed before the coordinator integrates this bounded checkpoint.

## Browser proof design and exact command

`Page.addScriptToEvaluateOnNewDocument` (the existing CDP `launch` init option) installs the probe **before entry load**. It wraps native registrations rather than reading production cleanup reports:

- Window/document/media listeners: callback identity, capture, once, explicit removal and AbortSignal removal.
- Timeout/interval and animation-frame registration, cancellation and actual callback delivery.
- Worker construction/termination; WebGL canvas context creation/loss/restoration.
- Resize/Mutation/Intersection/Performance observers: observed targets, unobserve and disconnect.
- Late storage writes, connected-DOM mutations, Canvas/WebGL draws and callback delivery. Actual history timeline and feedback activity are compared as well as final DOM/theme state.

Counts begin at a pre-load baseline. Painted normal/empty rows require a real prepared head/context; normal also requires a live worker and empty has none. They reuse 13b's decoded-pixel gate, arm feedback/resize/palette work, abort the actual lifetime and require exact baseline counts within ten seconds, without navigating, reloading, destroying the page or forcing GC. The two partial rows hold startup document reads and invoke the real non-persisted pagehide lifetime path in the same live page. Every held request must carry an aborted signal. Late facial/warm/document answers intentionally ignore cancellation; delivering them and new global input must cause no write, DOM mutation, draw, callback, activity or history change. Harness settling uses captured native scheduling, so test timers cannot hide application timers.

The CPU negative control intentionally retains listeners/timer/frame/worker/context/observer, observes **2/1/1/1/1/1**, then performs actual unregister/terminate/disconnect/context-loss operations and requires exact zero baseline. Duplicate listeners/contexts, once and signal removal, and late storage/draw detection are exercised. This validates the counter logic, **not Chrome/GPU cleanup**.

From `projects/xf-studio/authoring/`, in the coordinator's shell with working Chrome and prepared game/WolvenKit settings:

```powershell
$env:XFS_REQUIRE_ORACLES = '1'
& "$env:LOCALAPPDATA/Python/pythoncore-3.14-64/python.exe" ../../../tools/memory_guard.py --limit 4 -- bun test tests/core-startup-browser.test.ts tests/core-startup-resources.test.ts
```

The new painted rows copy settings into the disposable host and derive its private preview cache; they never deploy a mod or use the maintained Studio ports. The original 13b rows remain asset-free. All six Chrome rows skip cleanly without Chrome and fail the prerequisite under `XFS_REQUIRE_ORACLES=1`. A skip is never a browser pass.

## Gates and corrections

Every Bun process ran alone under the **4 GB** guard. No heavy gate, typecheck, desktop test, 038 harness, style-guide build, latency gate or standard WebGL set ran. No memory/disk floor or limit kill occurred. Types were read manually.

| Gate | Result |
|---|---|
| Pre-production normal baseline | **43 pass, 1 skip, 0 fail**, 10 files, **17 snapshots**, 414 assertions, **5.22 s**, **0.6 GB** peak. |
| First affected-owner/UI run | **61 pass, 18 fail**, 9 files, three matching snapshots, 587 assertions, **1.451 s**, **0.5 GB**. All failures came from incomplete window mocks lacking `removeEventListener`; corrected without changing assertions. |
| Interrupted browser-capable selection | Stopped at the original Chrome row after choice-preview cases completed; no final count/peak or browser result. Chrome was unexpectedly discoverable despite the brief's expected environment. The guard and its children were stopped; subsequent sandbox commands explicitly disabled Chrome process-locally. |
| Interrupted deferred-owner run | Four owner cases completed; stopped when a Bun rejection matcher waited before the test could release its deferred body. Replaced the harness wait with an attached outcome promise. No final count/peak. |
| Corrected owner/menu/startup selection | **33 pass, 6 Chrome skips, 0 fail**, 6 files, 230 assertions, **0.791 s**, **0.3 GB**. |
| Boundary/bootstrap/owner selection | **70 pass, 1 fail**, 6 files, 674 assertions, **8.87 s**, **0.3 GB**. New tip fixture lacked window dimensions; corrected its fixture only. |
| Corrected shell/warm/probe selection | **12 pass, 4 Chrome skips, 0 fail**, 3 files, 63 assertions, **0.104 s**, rounded **0.0 GB**. |
| Final permitted targeted selection | **409 pass, 7 skips, 0 fail**, **37 files**, **17 matching snapshots**, 4,275 assertions, **23.51 s**, **0.9 GB**. Includes architecture boundary, trusted bootstrap, view contributions, affected owners/UI, all CORE-03 parity/startup, workspace refusal and real accepted captures. |
| Original warm-owner expiry control | Archived **`73de0a0d` owner** passes **1 test**, five filtered, eight assertions, **0.051 s**, rounded **0.0 GB**. Uses the same synthetic delayed bitmap fixture; excludes new cancellation assertions. No baseline generated from refactored owner code. |
| Final owned-DOM/late-entry/public-contract follow-up | **53 pass, 6 Chrome skips, 0 fail**, 13 files, seven matching snapshots, 531 assertions, **1.88 s**, **0.5 GB**. Covers final shell node withdrawal/late-entry guards plus the unchanged public presentation key list. |

Final product-test union: **417 pass, 7 skips, no unresolved failure across 38 files**; the archived warm-owner control passes separately. There are **21 new CPU cases** (seven facial, six warm, six shell/update and two instrumentation) and four new required Chrome rows. The seven skips are one private-raster oracle and six Chrome rows. No browser or GPU result is claimed.

## Parity and compatibility

All eight retained files, containing **17 snapshots**, match the pre-edit baseline and HEAD after LF normalization; no snapshot was updated.

| Snapshot under `tests/__snapshots__/` | SHA-256 | Coverage |
|---|---|---|
| `core-context-parity.test.ts.snap` | `ce159a33b48fc3cd9639135b4524525746a2225589ad3f3b50719a00d76e2814` | Menu/popover text, state/order, hints/cursor/markup. |
| `core-guidance-parity.test.ts.snap` | `4d946713a250079eeed320adfddfb315c979b0ff462eca24651bb99bed6379ec` | Help/tours/anchors, onboarding and keys. |
| `core-viewport-parity.test.ts.snap` | `053a596936ce05af98fd1c0b9ac81233fd89152d9a0e8c0bb3bfc511b39d226b` | Bound UV navigation, independent selection/commit/Escape/release. |
| `core-preview-parity.test.ts.snap` | `d08aafdc22af193b07683329670dd8bdc6cd0fc0b81adc60eaec9e0f298ed342` | Preparation identities/bytes, raster and warm/superseded publication. |
| `core-file-export-parity.test.ts.snap` | `91776acef45b7c0cf506c7e213c6bb3c1585727f41442a0fb3532d8f5612a795` | Portable files, plans, Check/Build and omissions. |
| `core-placement-parity.test.ts.snap` | `27bb854c975e26d588d5cf6c3e92acea3b11ab3bd0a42ac25a024ca6058baa1d` | Product/framework/install defaults, identities and wording. |
| `core-product-parity.test.ts.snap` | `97afc5de336b0760c6699f4f904e1052f6ed91cb5d4440fb6e40472b2eef29ec` | Document/history/geometry identities, sharing and A/B/A. |
| `core-startup-parity.test.ts.snap` | `38072be50b2cf4d466af6bada1b57629357a50e03999347db9ecf932e1e4c2c9` | Registry/actions, catalogue/contribution IDs, layouts/workspace/migration/session/starters. |

Existing facial state/animation, warm restart, choice-preview, lighting/dial, theme/header, menus, tips, layout-tabs and UI-polish expectations pass. The pre-edit baseline covers the existing normal owner behaviour; the extra archived-owner control proves the taken-file expiry rule independently. These are source/CPU parity results, not new visual acceptance captures.

## Coordinator checks and remaining work

Run the command above and the withheld gates sequentially in the coordinator shell. Most affected GPU rows: **scene-dispose**, **scene-runtimes**, **renderer-device**, **choice-preview**, and context-loss/restore/detail loading. The new parse/decode cancellation touches character-detail cleanup; no shader, pixel arithmetic, raster or renderer algorithm changes. Existing scene-host/plate-composite and warm A/B/A rows protect unchanged visual output. Run dock-strip geometry (both), tree geometry and layout-tabs timing as required by the standing gate.

In isolated `?verify=1`, check light/dark and narrow/wide normal startup, real head paint, Help/tours/tooltips, system theme changes, menus/popovers, resizing and lighting-dial interaction. Abort with a toast, open menu/tour, queued resize/announcement and pending facial/warm read: the owned shell disappears while the page remains alive, and no late UI/write/draw returns. Repeat partial startup and `composition=empty`. Also repeat a refused-save pagehide: recovery/capture sources and hosted shell must remain available. Check menu dismissal with accepted file work, stable bound panels/history scopes, A/B/A and reload. No game session or deployment is requested.

13d still owns the approved UV-readiness feature contribution, mounted synthetic panel/editor/Undo/file substitution, mechanically enumerated feature/composition-only integration, retained-consumer closure and final acceptance. CORE-03 remains High until coordinator browser/GPU and closure gates pass.

Repository checks pass: **0 broken links/source paths across 504 tracked Markdown files**, **0 tracked-text private-path findings**, **0 privacy/source-path/link/whitespace/hash findings across all 40 changed/new files**, and clean `git diff --check`. All eight LF-normalized snapshot hashes match HEAD and the table above. Checkpoint/wrap-up footprint runs report **196.5/198.7 GB free on C**, 1 GB guards and rounded **0.0 GB** peaks; the unrelated inaccessible worktree scan remains incomplete. No task payload over 5 GB is retained. All owned test/guard/server/browser processes have ended; the two aborted-run owner markers both identify stopped PID 71128.

The three worktree scratch files (`check_changes.py`, `warm-baseline.test.ts`, `warm-baseline.ts`) and their directory were deleted: **17,748 bytes**, no links/reparse points, no remaining `projects/xf-studio/authoring/local/core-03-s13c3/` folder. Only the interrupted Chrome attempt's two disposable folders remain under this task's temporary root, `$env:USERPROFILE/.codex-mod/tmp/52336-mvsmt27h-260b54/`:

- `xfs-ui-chrome-wfuV13/`: 151 files, 6,791,869 bytes.
- `xfs-ui-data-P2aDCr/`: eight files, 468,548 bytes.

Both have zero reparse points: **159 files, 7,260,417 bytes total**. Automatic approval review rejected the owner/path-checked removal of those two stopped-run folders as **“blocked by policy”**, before executing the cleanup command. No alternative deletion route or approval escalation was attempted. They are coordinator cleanup, not retained proof artifacts.

**Knowledge used:** knowledge index and WebGL program linking (updated with source/CPU ownership evidence and browser limits); CORE-03 plan/as-built notes and 13c1/13c2 reports; architecture contract, UI architecture boundary, view-graph design, developer orientation and project/status/backlog context. The UI boundary's stale 13c2 public-signal wording is corrected. No game-engine fact was contradicted; integrated browser/GPU release evidence remains incomplete until coordinator execution.
