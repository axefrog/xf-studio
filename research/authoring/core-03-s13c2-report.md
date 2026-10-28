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
| `src/app/studio-presentation.ts` | No lifetime signals on the public port. Bootstrap/mount inject application lifetime separately into the UI runtime; accepted feedback survives normal menu dismissal. Protected panel/history APIs are unchanged. |
| `src/studio-ui/captured-runtime.ts` | Lifecycle-only: follows injected application lifetime and instance capture lifetime; removes forwarding subscription/pagehide/capture listeners on release. |
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

The skips are the optional six-private-raster reference case and two unavailable-Chrome normal/empty startup cases. Chrome was made unavailable process-locally only. No skip is a browser pass. Typecheck was deliberately withheld; internal mount/runtime lifetimes, `StartedOutbox` return types, transport signal signatures, fetch/lock-manager casts, timer handles and fixture callbacks were read manually.

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

## Recovery re-review after `49a5db3f`

Both recovery findings are fixed. The outbox exposes suspension, and the existing application access gate combines it with lease ownership. A suspended writer is read-only before another action/control/gesture can mutate its document. Presentation families and direct panel/empty-choice/default/starter routes use the same gate. The existing workspace notice shows its plain reason and Try again / Export this window's copy; recovery export remains available. The real-profile regression attempts a later opacity edit, proves refusal and unchanged document state, then downloads and parses the portable collection and compares its entire eye-makeup part with the shown recipe.

Supersession now suspends without terminal retirement. Explicit `documents.retryRecovery` checks the still-held lease and repairs protection before clearing suspension and resuming original-ID sends; pending background copies also prevent resumption. Failed protection returns a refusal instead of false success. Lease loss and terminal shutdown refuse without sending, with Export-copy/reopen guidance. A protection-only retry leaves editing paused until the explicit recovery action. Abandoned attempt identity checks prevent an old continuation from disturbing resumed work. Terminal shutdown still cancels admission, attempts, reads, timers and waiters before protection, and cannot be resumed. Normal handover still drains, protects all remaining keys, settles durable copies, releases the lease, then retires without persistence. No workspace-persistence or adapter release ordering changed.

Changed files (paths below `projects/xf-studio/authoring/` unless otherwise named):

| Files | Change |
|---|---|
| `src/platform/core/document-outbox.ts` | Exposed suspension, explicit guarded recovery transition/result and terminal-shutdown distinction; fences abandoned attempts. |
| `src/app/workspace/workspace-access.ts` (new) | Stateless access/notice projection over the lease and outbox, with transition-only notifications. |
| `src/app/presentation-status.ts`, `src/app/studio-presentation.ts` | Paused read-only projection and truthful presentation recovery capability/result; gates other action families. |
| `src/compose/studio-startup.ts` | Wires the same application access service to existing mutation routes; no policy added to startup. |
| `src/studio-ui/app.ts` | Selects the existing notice and recovery actions during suspension, including an active control run. No component/guide edit. |
| `tests/document-outbox-recovery.test.ts` (new), `tests/fixtures/profile-context-studio.ts` | Four real-profile/presentation regressions: exact shown-state export, failed protection followed by successful resumption, lost lease, terminal shutdown. |
| `tests/ui-polish-dom.test.ts` | Existing notice opens immediately and dispatches the recovery retry/export routes. |
| `tests/document-outbox.test.ts`, `tests/workspace-lease.test.ts` | Assert recoverable suspension rather than terminal retirement after supersession; retain drain/successor protection proofs. |
| `tests/profile-edit-contexts.test.ts` | Dirty-context retention injects a writer refusal directly; stopping the outbox now correctly refuses editing before mutation. |
| `research/authoring/core-03-plan.md`, `research/authoring/code-health.md`, `research/authoring/profiles-views-layouts-design.md`, `knowledge/webgl-program-linking.md`, this report | Current recovery/access contract, offline evidence and handoff. |

Bound-panel and capture **release** are unchanged. Existing root/fork inheritance carries the access gate to bound and captured facades; no new lifetime owner or registry. Normal redraw parity remains exact. `panels.bindings`, `panels.setBinding`, `authoring.historyScopes()`, `history.selectScope`, P3-v catalogue implementations/IDs, storage schemas and import allowances remain unchanged. CORE-03 remains High; 13c3/13d and coordinator browser/GPU responsibilities above remain open. Types were read manually; no typecheck ran.

| Recovery-fix gate | Result |
|---|---|
| First focused run | **21 pass, 1 fail**, three files, 168 assertions, **0.296 s**, rounded **0.0 GB** peak. Product behavior passed; export assertion was corrected to compare the portable part envelope with the shown recipe's envelope. |
| Focused plus notice | **72 pass, 1 fail**, four files, 572 assertions, **0.969 s**, **0.4 GB** peak. The notice test used the wrong light-DOM click helper. |
| Notice failure isolation | **0 pass, 1 fail, 50 filtered**, one file, four assertions, **0.086 s**, rounded **0.0 GB** peak; corrected to the harness's `click()`. |
| First targeted boundary/parity/startup run | **260 pass, 3 skip, 6 fail**, 24 files, 2,760 assertions, **19.50 s**, **0.8 GB** peak; 16 matching snapshots and one UV redraw mismatch. Found conservative browser-global string checks, obsolete terminal/dirty-edit test assumptions and duplicate normal notifications. No boundary rule or snapshot was relaxed. |
| Boundary/UV failure isolation | **41 pass, 3 fail**, two files, 435 assertions, **8.41 s**, **0.2 GB** peak. Recovery prose moved to its application owner; the core returns refusal codes. |
| Second targeted run | **265 pass, 3 skip, 1 fail**, 24 files, 2,818 assertions, **20.72 s**, **0.9 GB** peak; 16 matching snapshots and two extra UV draws. Removed redundant child-bootstrap access attachment; bound contexts inherit the root gate. |
| UV and recovery confirmation | **5 pass, 0 fail**, two files, 56 assertions, **0.291 s**, rounded **0.0 GB** peak; UV snapshot matches. |
| Final permitted targeted run | **266 pass, 3 skip, 0 fail**, 24 files, **17 matching snapshots**, 2,818 assertions, **20.63 s**, **0.9 GB** peak. Includes outbox, host lifetime, leases, real-profile contexts, notice, accepted captures, architecture boundary, trusted bootstrap, view contributions and all retained parity/startup files. |

All Bun processes ran sequentially under the 4 GB guard. No guard kill, heavy gate, desktop suite, typecheck, browser or GPU run. Skips remain private-raster and unavailable-Chrome cases. The eight snapshot hashes in the parity table above remain the compatibility baseline; none was updated. New recovery-only notice behavior is the requested correction, using existing controls and actions.

Repository checks: **0 broken links/source paths across 504 Markdown files**, **0 tracked-text privacy findings**, and clean `git diff --check`. The explicit changed/new-file scan covers **17 files**. Snapshot verification compares **Git/LF content**: all **eight hashes match HEAD and the retained table**. Its first raw-byte comparison flagged four CRLF working-tree files; normalizing their line endings proves identical content, with no snapshot change or Git diff. The wrap-up footprint has **203.1 GB free on C**, under the 1 GB guard with peak rounded **0.0 GB**; the unrelated inaccessible worktree scan remains incomplete. No new scratch, generated payload or owned process remains. The original cleanup limitation below is historical and unchanged.

Coordinator: use the exact guarded `core-startup-browser.test.ts` command above. In isolated `?verify=1`, fault backup storage and return superseded during a look send: confirm the plain read-only notice, refused opacity/control edits, unchanged look and matching Export copy. Repair storage with the lease retained, choose Try again and confirm sending/editing return. Repeat after lease loss: retry must refuse and Export copy/reopen remain the routes forward. Confirm ordinary two-window handover still shows its existing notice/actions. Release ownership and the WebGL rows named above are unchanged; no new browser/GPU proof is claimed.

## Notice-path re-review after `9ee0ab00`

The remaining Medium is fixed. `src/app/studio-presentation.ts` now shares one suspension-aware status reader between `port.status.snapshot()` (the shell's `Frame.status`) and aggregate `port.snapshot().status`. When not suspended it returns the host status unchanged. The pause message in `src/app/workspace/workspace-access.ts` is exactly:

> This window can't save changes, so editing is paused. Try again, or Export this window's copy.

`tests/document-outbox-recovery.test.ts` now supplies the same raw held-lease/outbox status shape as production, through the fixture's optional status-source factory (`tests/fixtures/profile-context-studio.ts`). The regression uses the real bound presentation port, starts an actual opacity control, suspends through supersession plus a failed backup, constructs the real shell `Frame` and `StudioRuntime`, and renders the existing workspace notice. It proves equal status paths, non-empty full rendered text, immediate visibility despite the active control, both labelled actions, and restoration of unchanged normal status/hidden notice after successful recovery. `tests/ui-polish-dom.test.ts` updates its earlier plain-message expectation. No production studio-ui, component/guide, startup, lifetime/release, persistence, access-gate or retry-policy change. Bound panels/captures retain their existing release paths; protected APIs, catalogue IDs and import allowances remain unchanged.

The other changed files are this report, `research/authoring/core-03-plan.md`, `research/authoring/code-health.md`, `research/authoring/profiles-views-layouts-design.md` and `knowledge/webgl-program-linking.md`: ten files in total. Owner abort ordering and the durability proofs above are unchanged. CORE-03 remains High; 13c3/13d, integrated browser/resource-baseline proof and coordinator GPU checks remain open.

| Notice-fix gate | Result |
|---|---|
| Initial regression setup | **0 pass, 1 fail, 4 filtered**, one file, three assertions, **0.237 s**, rounded **0.0 GB** peak. Starting a real control creates an additional pending history command; the helper no longer assumes one pending entry for that case. |
| Corrected pre-fix reproduction | **0 pass, 1 fail, 4 filtered**, one file, six assertions, **0.177 s**, rounded **0.0 GB** peak. Real Frame status is writable with an empty message while aggregate status has the pause message. |
| Focused recovery validation | **5 pass, 0 fail**, one file, 66 assertions, **0.282 s**, rounded **0.0 GB** peak. |
| Final permitted targeted run | **188 pass, 3 skip, 0 fail across 19 files**, **17 matching snapshots**, 2,324 assertions, **19.09 s**, **0.9 GB** peak. Includes changed recovery/notice tests, affected profile fixtures, architecture boundary, trusted bootstrap, view contributions and retained parity/startup tests. |

All Bun processes ran sequentially under the 4 GB guard. No heavy gate, typecheck, browser or GPU run; the three skips remain private-raster and unavailable-Chrome cases. Retained snapshot hashes/coverage are the table above (Git/LF content); no snapshot update or compatibility change. Types were read manually. No new scratch or generated output was created.

Repository checks pass: **0 broken links/source paths in 504 Markdown files**, **0 tracked-text privacy findings**, **0 privacy/source-path/whitespace findings across all ten changed files**, clean `git diff --check`, and **all eight Git/LF snapshot hashes match HEAD and the retained table**. Wrap-up footprint: **202.8 GB free on C**, 1 GB guard, rounded **0.0 GB** peak; the unrelated inaccessible worktree scan remains incomplete. No new payload above 5 GB is retained, and all owned jobs have ended. The historical scratch-cleanup limitation below is unchanged.

Coordinator: the exact guarded browser command above still applies. In isolated `?verify=1`, fault backup storage and return superseded while an opacity control is active. The notice must open immediately with the exact text above and Try again / Export this window's copy. Repair storage with the lease retained and retry: the notice clears and normal editing returns. No new WebGL ownership path is touched; the previously listed GPU checks remain coordinator work.

## Full-suite corrections after `b5f55a40`

Both reported files now pass, uncommitted. The reference specification's queue order and all comparisons remain unchanged.

- **Stopped outcomes:** reproduced desktop **1000/293**, **8919/338**, **16838/232**, **48514/57**, **56433/32**, **214813/287**, **365274/199** and **792900/148** (seed/step). The crash harness used completed `status.stopped` as its kill boundary. Since `49a5db3f`, stop suspends and settles waiters before protecting backups; failed desktop protection can leave `stopped: false` after callers already heard `stopped`. The oracle therefore missed a kill, then expected no outcome yet or a later conflict-resolution `dropped`. It now records its own injected kill event, independently of implementation status, and applies the existing exact stopped/restart rule there, including kills while opening. The model comments explain why. No outcome is accepted as an alternative and no comparison is weakened.
- **Queue order:** reported desktop **222732/349**, `a6-2m71tx1t` before `a9-6s0r2425`. That seed passed in isolation before correction: the failure is clock-dependent. The deterministic regression reproduces the same older/newer reversal with a clock behind an older launch's sequence. `open()` reset sequence from only surviving repaired intents (`bf63f0da5`); `nextSeq()`'s later wall-clock floor (`9b9339ae8`) cannot preserve the order when an earlier burst has outrun the clock. A newer merged key can hide an older durable intent until a crash restores it, so a later intent can get a smaller sequence and `repair` sorts it first. No 13c2 change directly rearranged that queue: it exposed this pre-existing timing hole. Opening now reserves the maximum sequence from **all loaded and durable copies**, including hidden/removed intents. The new deterministic test fails before this production fix and passes after it. The original random model clock is retained; a temporary frozen-clock investigation was removed. The final full seeded run includes 222732 and every listed outcome seed.
- **Public contract:** `tests/studio-presentation.test.ts` is untouched and passes its original key-list assertion. `signal` and `applicationSignal` are removed from the public port/type. Bootstrap passes application lifetime as a separate mount argument; shell and instance runtimes forward it internally to captures and accepted-feedback checks. Presentation/device mechanics genuinely need this narrow `AbortSignal` to close detached menus and suppress post-await feedback after application abort. Menu dismissal alone still preserves accepted feedback. No new public capability or registry was added; the existing capture acquisition signature remains unchanged.

Changed files (under `projects/xf-studio/authoring/` unless named otherwise):

| Files | Change |
|---|---|
| `src/platform/core/document-outbox.ts` | Preserve loaded/durable sequence high-water mark before new commands; no sort, schema or release-policy change. |
| `tests/document-outbox-model.test.ts` | Model the independent kill/suspension boundary exactly; add deterministic recovery-order regression. |
| `src/app/studio-presentation.ts` | Restore the public port/type key contract by removing both signal properties. |
| `src/app/trusted-studio-bootstrap.ts`, `src/compose/studio-startup.ts` | Pass application lifetime separately through the trusted mount callback. |
| `src/studio-ui/app.ts`, `src/studio-ui/runtime.ts`, `src/studio-ui/captured-runtime.ts`, `src/studio-ui/panels/instance-panels.ts`, `src/studio-ui/panels/instance-view-pane.ts` | Lifecycle-only injection/forwarding of the existing application signal; capture subscriptions/listeners retire and late feedback stays suppressed. No component/guide change. |
| `tests/fixtures/profile-context-studio.ts`, `tests/profile-instance-controllers.test.ts` | Exercise internal mount lifetime directly rather than reading signal properties off the public port. |
| `research/authoring/core-03-plan.md`, `research/authoring/code-health.md`, `research/authoring/profiles-views-layouts-design.md`, `knowledge/webgl-program-linking.md`, this report | Current ownership/ordering contract, seed evidence and handoff; 17 files total. |

| Correction gate | Result |
|---|---|
| Original-clock isolated 222732 | **1 pass, 1 filtered**, one assertion, **0.180 s**, rounded **0.0 GB** peak; reported order failure does not reproduce in this timing. |
| Original-clock isolated 1000 | **0 pass, 1 fail, 1 filtered**, one assertion, **0.167 s**, rounded **0.0 GB** peak; reproduces stopped versus dropped at 293. |
| Original full model baseline | **1 pass, 1 fail**, two tests, **8.27 s**, **0.5 GB** peak; eight outcome seeds above fail. |
| Temporary coarse-clock 222732 diagnostic | **1 pass, 1 filtered**, one assertion, **0.239 s**, rounded **0.0 GB** peak. |
| Temporary coarse-clock full model diagnostic | **2 pass, 0 fail**, **43,600 steps**, **12.89 s**, **0.4 GB** peak. This diagnostic clock was removed before final validation. |
| Deterministic order regression before production fix | **0 pass, 1 fail, 2 filtered**, one assertion, **0.089 s**, rounded **0.0 GB** peak; actual newer/older order reverses the required older/newer order. |
| Corrected full model file, original clock | **3 pass, 0 fail**, **43,600 steps**, 60 assertions, **12.12 s**, **0.4 GB** peak. |
| Unchanged presentation contract file | **8 pass, 0 fail**, 96 assertions, **0.211 s**, rounded **0.0 GB** peak. |
| Final permitted targeted union | **134 pass, 3 skip, 0 fail across 21 files**, **17 matching snapshots**, 2,280 assertions, **26.83 s**, **1.0 GB** peak. Includes both requested files, the exact model after independent kill recording, captured runtime/accepted-work proofs, recovery, boundary/bootstrap/contributions and retained parity/startup tests. |

All Bun processes ran sequentially under the 4 GB guard, including the two requested files separately. No heavy gate, broad suite, typecheck, browser or GPU run. Types were read manually. The three skips remain private-raster and unavailable-Chrome cases; all eight Git/LF snapshot hashes retain the table above. No unique scratch/generated payload was created. The original scratch-cleanup limitation below is unchanged.

Repository checks: **0 broken links/source paths across 504 Markdown files**, **0 tracked-text privacy findings**, **0 privacy/source-path/whitespace/snapshot findings across all 17 changed files**, clean `git diff --check`, and **all eight Git/LF snapshot hashes match HEAD and the retained table**. Footprint: **198.8 GB free on C**, 1 GB guard, rounded **0.0 GB** peak; the unrelated inaccessible worktree inventory remains incomplete. No new task payload above 5 GB is retained. All owned jobs have ended.

Abort/release ordering remains pending protection → permitted workspace release/consumer teardown → durable handoff → lease stop. Bound-panel and capture release rules are unchanged; only lifetime transport moves off the public facade. `panels.bindings`, `panels.setBinding`, `authoring.historyScopes()`, `history.selectScope`, P3-v catalogue implementations/IDs and import allowances remain unchanged. CORE-03 stays High; 13c3/13d and the exact coordinator browser command above remain open. In isolated `?verify=1`, repeat normal menu dismissal with an accepted picker (normal feedback), then application abort with a detached menu/picker/Check (menu closes, no late feedback/result). Existing two-window/recovery checks and the previously listed scene-dispose/scene-runtimes/renderer-device/choice-preview GPU rows remain coordinator work; no new GPU proof is claimed.

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
