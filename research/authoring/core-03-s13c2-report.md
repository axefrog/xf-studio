# CORE-03 slice 13c2 report

Implemented **13c2 only**, from `3a2ecc71`, on `claude/core-03`, committed by the coordinator as `b7133b7a`. The review corrections below are uncommitted. CORE-03 remains **High**: 16 of 18 checkpoints implemented; 13c3 and 13d remain. No heavy gate, typecheck, desktop test, 038 harness, style-guide build, latency gate, browser/GPU run, game/MO2 action, maintained-server operation, subagent, commit or push occurred.

## Release order and durability

1. Before publishing root abort, startup settles existing edits and commits look writers, asks the outbox to secure synchronous recovery, then asks the existing workspace session to release. A synchronous backup failure or the workspace's refusal keeps the application alive. **13c1's workspace persistence implementation is unchanged**, including dirty lease-loss recovery, exact successful-plan comparison and no extra autosave serialization.
2. Root abort releases consumers and their captures through the existing owner lifetimes. Panel retirement still transfers accepted work; application retirement ends it. File/collection owners cancel pending selection, reads, Check/Build/progress, release writer captures/result readers and suppress late outcomes, downloads and feedback. Accepted writes remain with their existing durable owner.
3. The host adapter queues its final shutdown in a microtask after those synchronous consumers retire. Outbox stop first suspends admission/sending and cancels attempts/lookups/timers/waits, then protects deferred/failed keys and retires on success. Protection failure preserves pending values for explicit recovery without resuming sends. In-flight commands retain their original stored IDs for receipt/retry; a late answer changes nothing.
4. The started outbox waits for the desktop storage's outstanding background copies, including an in-flight copy. Only a successful durable handoff calls lease stop. Failed protection retains the lease and pending entries, reports why, and permits a storage-handoff retry. No automatic retry loop is added.
5. Lease stop withdraws pending takeover/acquisition work, releases the localhost Web Lock, removes its listener and closes its BroadcastChannel, or aborts/cancels the desktop stream and reader. Generations become unavailable. A retained outbox command throws an explicit released-workspace reason; the retained transport returns `superseded`, without sending.

Normal requested handover drains queued entries, protects every remaining backup (including conflicts), settles durable copies, then follows the existing workspace-save/release protocol. Failed protection keeps the lease editable for recovery; confirmed-release retirement and later stop calls perform no persistence or storage settlement. An already stopped handover outbox permits subsequent clean root retirement. The lease still starts before Studio; neither host entry's composition order changes. Localhost initial acquisition retains `{ ifAvailable: true }`; its callback/registration follows the adapter lifetime. W3C forbids combining that option with `signal`, so queued takeover/resume requests carry cancellation separately. [Web Locks request algorithm](https://www.w3.org/TR/web-locks/#dom-lockmanager-request).

Accepted named-version writes already sent are allowed to finish under their existing owner; retirement prevents subsequent service publication/readback. Document writes have the stronger persisted original-command replay proof below. A failed storage handoff retains ownership rather than claiming successful release. These are CPU/source proofs, not whole-desktop process-crash or power-loss measurements.

## Changed files

Paths in the next two tables are relative to `projects/xf-studio/authoring/`.

| Production file | Ownership change |
|---|---|
| `src/app/browser/workspace-lease-device.ts` | Localhost stop owns generation cancellation/retry waits, queued lock/takeover repeats, held lock, listener and channel. Desktop stop owns acquisition/takeover waits, fetch/stream reader and late-stream refusal. Removes the independent localhost pagehide lifetime so it cannot precede the workspace's release decision. |
| `src/app/workspace/workspace-lease.ts` | Exposes idempotent owner stop through the adapter, withdraws takeover and hooks, fences late start/grant results. |
| `src/platform/core/document-outbox.ts` | Stop secures pending/failed backups, refuses retirement on synchronous failure, cancels attempts/lookups/read checks and every scheduled timer, ends waiters and suppresses late answers. Released commits/immutable puts refuse explicitly. |
| `src/app/browser/document-outbox-device.ts` | Owns synchronous pre-release protection, transport refusal after stop, focus/revision-check withdrawal, durable-storage settlement and final application-to-lease handoff. |
| `src/compose/studio-startup.ts` | Wiring only: binds existing host owners to the root lifetime, and calls outbox protection before early/session workspace release. |
| `src/app/profiles/panel-editing-contexts.ts` | Bounds acquisitions, detached capture handles and retained bindings by the application signal. Application abort destroys held writers even when panel captures remain; ordinary retirement still waits for transferred work. |
| `src/app/trusted-studio-bootstrap.ts` | Passes the one application lifetime through child bootstraps, file owners, bound contexts and presentation, independently of an individual panel/menu signal. |
| `src/app/studio-file-operations.ts` | Application-bounded execution owner; unsubscribes before cancellation, releases operations, captures and live collection reads, and refuses later work. |
| `src/app/accepted-studio-operation.ts` | Owns cancellable waits even for an uncooperative picker/transport, immediate capture/result-reader release, Build cancellation, and no late result/download/publication. |
| `src/app/browser/browser-file-device.ts` | Picker takes an optional signal; abort removes change/cancel listeners and resolves the wait without applying a late selection. |
| `src/library/collection-service.ts` | Owns request/read/progress cancellation and guards async continuations before further work or publication. Accepted version writes keep their existing lifetime. Check remains unavailable to user Stop while becoming cancellable on application release. |
| `src/library/browser/collection-transport.ts` | Passes read/progress signals to existing HTTP adapters. |
| `src/legacy/eye-makeup/export/package-action.ts` | Optional signal on progress reads only; no Check/Build inputs, compiler, package, manifest or pipeline-stage change. |
| `src/app/studio-presentation.ts` | Optional facade and application signals. Captures follow the facade; accepted feedback follows the application and survives normal menu dismissal. Protected panel/history APIs are unchanged. |
| `src/studio-ui/captured-runtime.ts` | Lifecycle-only: follows the captured facade's signal and removes its forwarding subscription/pagehide/capture listeners on release. |
| `src/studio-ui/runtime.ts` | Lifecycle-only: suppresses post-await file/library feedback when the application retires. Menu dismissal alone preserves normal accepted feedback. |

| Test/fixture file | Evidence |
|---|---|
| `tests/workspace-host-lifetime.test.ts` (new) | Ten cases: clean stopped handover; Web Lock/channel release; registration/takeover cancellation and late grant; pending desktop acquisition/takeover and late stream; refused workspace release; pending and real desktop in-flight backup before lease stop; failed durable handoff/retry. |
| `tests/document-outbox-lifetime.test.ts` (new) | Five cases: pending-at-stop storage/late refusal/timers; in-flight lost-transport retry; in-flight committed receipt replay; failed synchronous protection/retry; cancelled revision/dependency reads with late-publication refusal. |
| `tests/accepted-work-lifetime.test.ts` (new) | Real bound Check survives panel retirement, then application abort cancels its transport and releases all target captures; abort during a delayed snapshot starts no package work afterward. |
| `tests/accepted-studio-operation.test.ts` | Twenty operation-matrix abort cases plus an uncooperative-picker wait. Existing normal dependency/observable matrix remains intact; fixture optionally accepts the application signal. |
| `tests/profile-instance-controllers.test.ts` | Real menu capture/writer release and no late file/library feedback; a normal accepted picker still records exactly the baseline feedback after menu dismissal. Existing controller/capture-transfer tests remain unchanged. |
| `tests/fixtures/profile-context-studio.ts` | Optional root signal passed through the real bootstrap; no alternate construction path. |
| `tests/browser-device-boundary.test.ts` | Picker abort removes both listeners, ends its wait, ignores late selection and refuses a pre-aborted reopen. |
| `tests/core-startup-release.test.ts` | Extends the real partial-start failure test: pending outbox key is stored before lease stop; diagnostics' uncancelled keepalive handoff remains intact. |
| `tests/browser-workspace-lease-start.test.ts` | Channel double supports stop; lock double enforces W3C's invalid option combination. |
| `tests/workspace-lease.test.ts` | Channel double supports stop; normal lease policy/handover assertions unchanged. |
| `tests/profile-context-review.test.ts` | Check now receives a live application-cancellation signal; all existing assertions that it advertises no user cancellation remain unchanged. |

Repository records: this report, `research/authoring/core-03-plan.md`, `code-health.md`, `ui-architecture-boundary.md`, `editor-invariants.md`, `profiles-views-layouts-design.md`, `research/backlog/README.md`, and `knowledge/webgl-program-linking.md`. **35 changed/new files** in total; no component library, style guide or renderer source changes.

## Specific durability proofs

| Required case | Test and observed result |
|---|---|
| Pending at abort → persisted | `document-outbox-lifetime`: “stop persists deferred edits…” stores the actual pending value and cancels timers without sending. `workspace-host-lifetime`: “root abort persists…” observes workspace permission → key stored → lease stopped, with zero document sends. |
| In flight at abort → completes or persisted retry | Both “in-flight abort preserves the original command…” cases reopen the same storage and replay the identical ID; the real store reaches revision **1**, value **6**, whether the first request committed or never reached the store. Late success/failure emits nothing and rewrites no key. |
| Desktop in-flight backup precedes lease release | “desktop in-flight backup lands…” uses the real desktop storage owner, blocks its host copy, and sees generation **8** still held when it lands. Stream shutdown follows the durable write. The late document reply cannot remove the persisted original command. |
| After release → explicit refusal, zero writes | Released `commit` and immutable `put` throw the released-workspace message; retained transport returns `superseded`. Stored bytes and send counts stay unchanged. |
| Protection failure → retain recovery | Synchronous failure returns false from stop with pending value **7** and warning intact; repair persists it. Failed desktop settlement retains its lease and stored key, reports its recovery reason and supports a successful explicit handoff retry. |
| Dirty workspace refusal preserves lease | The host lifetime test refuses root abort before any host stop. All 14 unchanged workspace-lifetime cases also pass, including both real dirty lease-loss Export-copy cases; all 15 persistence cases retain exact-plan/quota/reservation behavior. |
| Detached accepted work stops at application release | Matrix, real bound Check, real menu/runtime and picker tests prove immediate capture release, cancellation, no late downloads/results/feedback, and no new package step after release. Normal palette/menu transfer and initiating-owner progress/Stop/freshness remain covered. |

## Gates

Every Bun process ran alone under `tools/memory_guard.py --limit 4` using the full-path Python executable. No quiet window was relayed; no memory/disk floor or limit kill occurred. The withheld heavy gates remain coordinator-owned.

| Run | Result |
|---|---|
| Pre-production baseline at `3a2ecc71` | **80 pass, 1 skip, 0 fail**, ten files, **17 snapshots**, 792 assertions, **3.49 s**, **0.6 GB** peak. All eight parity files plus accepted-operation and browser-lease startup behavior. |
| First owner-focused run | **158 pass, 0 fail**, seven files, 1,193 assertions, **1.98 s**, **0.4 GB** peak. |
| Intermediate architecture/controller/startup probe | Output capture ended after 27 passing architecture cases and did not retain a terminal summary. Not counted as a completed gate; the complete final run below subsumes all three files. No result is inferred from the missing tail. |
| Expanded durability/controller run | **162 pass, 2 fail**, nine files, 2,571 assertions, **7.82 s**, **0.6 GB** peak. Fixed a disposed file owner still reading its collection's changing busy state, and corrected the new startup assertion to await the asynchronous durable handoff. No expected normal behavior was relaxed. |
| Complete final targeted gate | **357 pass, 3 skip, 0 fail**, 29 files, **17 snapshots**, 4,285 assertions, **29.72 s**, **1.3 GB** peak. Includes the required architecture/bootstrap/view-contribution gates, affected owners, unchanged workspace durability proofs and all CORE-03 parity/startup tests. |
| Normal accepted-feedback baseline | **1 pass, 0 fail**, one scratch probe, two assertions, **0.153 s**, peak rounded **0.0 GB**. Executes `StudioRuntime` extracted from `3a2ecc71` with only its relative imports relocated; proves exact picker feedback after menu dismissal before the final correction. |
| Final facade/application-signal correction | **60 pass, 3 skip, 0 fail**, 14 files, **17 snapshots**, 1,451 assertions, **6.24 s**, **0.8 GB** peak. Rechecks real controllers, bootstrap and every parity/startup file. Application abort still suppresses feedback; normal menu dismissal preserves the baseline behavior. |
| Final product-test union | **358 pass, 3 skip, 0 unresolved fail across 29 files**; 42 new lifecycle/regression cases. Runs overlap and are not additive. The one archived-runtime reference probe is reported separately. |

The skips are the optional six-private-raster reference case and two unavailable-Chrome normal/empty startup cases. Chrome was made unavailable process-locally only. No skip is a browser pass. Typecheck was deliberately withheld; optional facade/application lifetimes, `StartedOutbox` return types, transport signal signatures, fetch/lock-manager casts, timer handles and fixture callbacks were read manually.

## Frozen parity and compatibility

All eight files, holding **17 snapshots**, remain byte-unchanged in Git and match before/after. SHA-256 uses LF-normalized bytes, as prior reports do.

| Snapshot file | SHA-256 | Coverage |
|---|---|---|
| `core-context-parity.test.ts.snap` | `ce159a33b48fc3cd9639135b4524525746a2225589ad3f3b50719a00d76e2814` | Menus/popovers, labels/states/order, hints/cursor/markup. |
| `core-guidance-parity.test.ts.snap` | `4d946713a250079eeed320adfddfb315c979b0ff462eca24651bb99bed6379ec` | Help/tours/anchors, onboarding and keyboard behavior. |
| `core-viewport-parity.test.ts.snap` | `053a596936ce05af98fd1c0b9ac81233fd89152d9a0e8c0bb3bfc511b39d226b` | Bound UV navigation, independent selection/commit/Escape/release. |
| `core-preview-parity.test.ts.snap` | `d08aafdc22af193b07683329670dd8bdc6cd0fc0b81adc60eaec9e0f298ed342` | Preparation/cache outputs, raster bytes, warm holds/supersession/publication. |
| `core-file-export-parity.test.ts.snap` | `91776acef45b7c0cf506c7e213c6bb3c1585727f41442a0fb3532d8f5612a795` | Portable files/names/refusals, plans, Check/Build inputs/omissions. |
| `core-placement-parity.test.ts.snap` | `27bb854c975e26d588d5cf6c3e92acea3b11ab3bd0a42ac25a024ca6058baa1d` | Product/framework/install identities/defaults/wording. |
| `core-product-parity.test.ts.snap` | `97afc5de336b0760c6699f4f904e1052f6ed91cb5d4440fb6e40472b2eef29ec` | Document/history/geometry identities, keyed sharing and A/B/A. |
| `core-startup-parity.test.ts.snap` | `38072be50b2cf4d466af6bada1b57629357a50e03999347db9ecf932e1e4c2c9` | Registry/actions, modules/products, contribution/instance metadata and IDs, layouts/workspace/migration/session/starters. |

The three corrected 2048 mask RGBA hashes also match the retained slice-11 values. No snapshot was updated. No storage schema, resource identity, export filtering/compiler/package/manifest/promotion rule or architecture import allowance changes. `panels.bindings`, `panels.setBinding`, `authoring.historyScopes()` and `history.selectScope` remain unchanged. P3-v's contribution and instance catalogue implementations/IDs are untouched; bound contexts/capture release are the only changed panel ownership seam.

## Coordinator browser/GPU handoff

From `projects/xf-studio/authoring`, with `CHROME` naming a real Chrome executable:

```powershell
$env:XFS_REQUIRE_ORACLES = '1'
& "$env:LOCALAPPDATA/Python/pythoncore-3.14-64/python.exe" ../../../tools/memory_guard.py --limit 4 -- bun test --timeout 180000 tests/core-startup-browser.test.ts
```

That exact existing CDP command checks normal/empty mount and paint in disposable `?verify=1` host/browser state on a transient port. **It does not supply 13c3's future integrated resource-baseline/partial-start/late-publication proof.** No browser or GPU result is claimed here.

Manual `?verify=1` checks:

- Open two windows; confirm normal holder/read-only behavior and takeover. Abort a clean holder with `window.xfStudioLifetime.abort()`; the next window should acquire its released lock/stream. Abort an initially read-only window without disturbing the holder.
- Edit layout/theme/look just before abort or pagehide, reopen and confirm persistence. Repeat dirty lease-loss abort: root must refuse, retain recovery and preserve Export this window's copy. Keep the 13c1 quota-fallback/reservation and unchanged-click cases.
- Start a picker, mask export or Check/Build through an unseen pinned panel/menu, dismiss the menu or change focus/drawn look, then let it finish: its captured destination/progress/result and normal feedback must remain correct. Repeat with application abort: no late import, download, success/error feedback or result, and no further package work/progress requests.
- Check same-look sharing, independent bindings, A/B/A, scoped Undo/Redo and reload identities. Compare normal startup/menus in light/dark at narrow/wide panels. No markup/style change is intended; no new visual PASS is claimed.
- On desktop, abort while an outbox backup is waiting; verify the host copy lands before its lease stream ends. Fault-injected handoff failure must retain ownership/recovery rather than silently report a released workspace.

Most affected standard WebGL rows: **scene-dispose** and **scene-runtimes** (capture-held context/runtime release), **renderer-device** (shared device release after consumers), and **choice-preview** (head-context release). Existing plate-composite/scene-host/warm A/B/A rows protect unchanged raster/surface ownership. The coordinator runs the standard WebGL set, both dock-strip geometry tests, tree-view geometry and layout-tabs timing sequentially in its shell, plus all withheld authoring/desktop/038/style-guide/latency gates and independent review.

## Review corrections after `b7133b7a`

Both review findings are fixed. Normal handover now requires successful protection after its drain; a conflict with a failed backup refuses release, retains the lease and can retry once storage recovers. Confirmed `onReleased` cleanup calls the outbox's write-free `retire`, and subsequent adapter/core stop, protect, store and retry calls cannot write or settle the old storage. The two-holder regression reproduces the original overwrite before the fix, then proves zero old-window writes/settlements and byte-identical preservation of the new holder's key after the fix.

Shutdown now suspends command admission and sending independently of backup success. It cancels in-flight attempts, dependency/revision work, timers and waiters before protection; failed protection retains pending values/IDs and warning state for explicit backup recovery. `superseded` is terminal for sending even when stop returns false. Two bounded regressions cover direct supersession and failed backup plus an in-flight transport failure through the started adapter; each keeps its one original command, admits no later command and makes only one transport attempt. Their unfixed reproductions have a twelve-attempt backup safety valve so the microtask loop cannot starve the test process.

Only `src/platform/core/document-outbox.ts`, `src/app/browser/document-outbox-device.ts`, their two lifetime test files and the five plan/report/ledger/design/knowledge records change. No startup, workspace persistence, bound panel/capture, facade, studio-ui, component/guide, protected API, catalogue, snapshot or import-allowance edit. CORE-03 remains High; 13c3/13d and the browser/GPU handoff above are unchanged. Relevant types were read manually; typecheck/heavy gates remain withheld.

| Review-fix gate | Result |
|---|---|
| Bounded pre-fix reproductions | **15 pass, 3 fail**, two files, 105 assertions, **0.142 s**, rounded **0.0 GB** peak. Both loop repros reach their safety valve. The new handover fixture initially stopped on the second holder's recovery gate; it was corrected to await that holder's replay before editing. |
| Corrected handover pre-fix reproduction | **0 pass, 1 fail, 11 filtered**, one file, three assertions, **0.077 s**, rounded **0.0 GB** peak. It shows premature release, two old-window writes/two settlements after release and an overwritten second-holder key. |
| Focused fix validation | **77 pass, 0 fail**, four files, 495 assertions, **1.235 s**, **0.4 GB** peak. |
| Final targeted boundary/parity/startup/persistence validation | **189 pass, 3 skip, 0 fail across 21 files**, **17 snapshots**, 1,637 assertions, **22.36 s**, **0.9 GB** peak. This subsumes the focused passes and includes all three new regressions. |

All Bun processes ran sequentially under the 4 GB guard; no guard kill, heavy gate, typecheck or browser/GPU run. Skips remain private-raster and unavailable-Chrome cases. All original snapshot bytes/hashes remain unchanged. The footprint checkpoint has **203.9 GB free on C** (1 GB guard, rounded **0.0 GB** peak), with no new scratch or retained payload. Repository checks pass: **0 broken links/source paths across 504 Markdown files**, **0 tracked-text privacy findings**, **0 privacy/source-path/whitespace/hash findings across all nine changed files**, and clean `git diff --check`. All eight snapshot files remain byte-unchanged. No new scratch/output is retained; all owned jobs have ended. The original committed checkpoint's gate counts and cleanup history below remain provenance, not new runs.

## Remaining work and cleanup

- **13c3:** complete shell/facial/warm-start listener/request/timer/frame/observer cancellation and integrated normal/empty/partial-start CDP resource-baseline/late-publication proof without destroying the page.
- **13d:** UV-readiness feature contribution with normal parity, mounted synthetic panel/editor/Undo/file substitution, enumerated feature/composition-only integration and retained-consumer closure, plus coordinator browser/GPU results.

Repository gates pass: **0 broken links/source paths across 503 tracked Markdown files**, plus **0 link findings in the new report**; **0 private-path findings in tracked text**; **0 privacy/source-path/trailing-whitespace findings across all 35 changed/new files**; clean `git diff --check`. All eight snapshot hashes were reverified, with zero snapshot edits. The final wrap-up footprint is **205.7 GB free on C**, versus **206.3 GB** at checkpoint; both ran under the 1 GB guard with peak rounded **0.0 GB**. No task payload above 5 GB is retained. The footprint tool marks an unrelated inaccessible worktree scan incomplete; it does not report a complete inventory for that worktree. All owned test/guard/check processes have ended.

Automatic approval review rejected scratch deletion as **“blocked by policy”** before executing the cleanup command; no alternative deletion or approval escalation was attempted. The ignored `projects/xf-studio/authoring/local/core-03-s13c2/` directory contains these four regular files, **64,359 bytes total**, with no junction/reparse point in the directory or file listing. They are regenerable; this report retains their evidence and provenance. Coordinator cleanup paths:

- `projects/xf-studio/authoring/local/core-03-s13c2/runtime-baseline.ts` (13,499 bytes).
- `projects/xf-studio/authoring/local/core-03-s13c2/feedback-baseline.test.ts` (1,348 bytes).
- `projects/xf-studio/authoring/local/core-03-s13c2/final-targeted.log` (41,510 bytes).
- `projects/xf-studio/authoring/local/core-03-s13c2/feedback-followup.log` (8,002 bytes).

**Knowledge used:** knowledge index and WebGL program linking (updated with CPU/source capture/durability boundaries); CORE-03 plan/as-built notes and 13c1 report; profiles/lease/outbox design, experiment 038 records, architecture contract, UI boundary, editor invariants, developer orientation and project/backlog/status context; W3C Web Locks request algorithm. No game-engine fact was contradicted. Prior records' pending 13c2 ownership statements are updated; complete mounted resource/GPU evidence remains incomplete for 13c3.
