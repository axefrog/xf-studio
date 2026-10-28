# CORE-03 slice 13b report

Composition-driven real startup is implemented from `c0378c9c`. Changes stay uncommitted for coordinator review. CORE-03 remains **High**. Normal startup has no intended visible change. Chrome is unavailable here; real-entry mount/paint and GPU results remain coordinator-owned.

## Composition and isolation

`startStudio(host, { composition, signal })` passes composition into the existing real `start`, which returns `{ signal, abort }`. The localhost entry validates composition before starting its lease/outbox. The desktop calls the same shared root; no alternative bootstrap was added.

The composition supplies the action/part/module registrations, product and framework-product metadata, view contributions/catalogue/factories, module-service selection, renderer factories, layered surfaces and face posers. Those registrations determine fragment knowledge, default layouts, the initial arrangement, state-preserving panel types and dynamic experiment catalogue inputs. Root file/mask, migration/session, profile/core, preview/editor, setup/bootstrap, collection/empty-choice and shell wiring all consume those supplied inputs.

The root's **19 non-import uses of eight fixed `STUDIO_*` constants** move: `STUDIO_COMPOSITION` 10, `STUDIO_PRODUCT` 2, `STUDIO_INITIAL_LAYOUT` 2, and `STUDIO_CATALOGUE`, `STUDIO_VIEW_COMPOSITION`, `STUDIO_RENDERERS`, `STUDIO_LAYERED_SURFACES`, `STUDIO_FACE_POSES` once each. Expression framework metadata, starter/region interpretation, module-service selection and layout `keepsState` wiring also become composition/contribution inputs.

Eye makeup's existing registration now contributes `workspace.load` and `starters.create`. The former preserves the released memory/default projection and returns neutral workspace state; the latter owns region/shape interpretation, starter actions and first-part construction. Empty registration needs neither. The existing workspace composer/persistence/migration path accepts neutral state, including real session storage, without fabricating a recipe, facade, geometry cache or editor. Released in-memory callers retain their compatibility path.

`?verify=1&composition=empty` selects the shell with zero features and part-less modules. Alternate supplied compositions, including synthetic ones, require exactly `verify=1`. Query selection outside that scope throws before localhost lease/outbox startup, including `?verify`, `?verify=0` and unknown alternate names. Normal startup always selects the normal composition. No ordinary UI exposes the selector.

Verification retains the existing separate workspace key, workspace identity/Web Lock/lease route, outbox prefix/fence, `/api/verification/documents`, migration, library/collections, settings, part presets, poses, update and install paths. Desktop retains its verification workspace file, settings and lease/outbox host paths. Hosts remain wired; shared derived-asset/preparation read routes retain their existing behavior. No normal library/workspace/settings are used by the new offline isolation gates. The browser test uses a disposable real server with empty settings and a fresh browser profile, checks a normal-workspace sentinel and rejects normal authored-data/settings routes. No maintained port, game or MO2 session was touched here.

## P3-v and lifetime

P3-v changes are composition-fed wiring: the target resolver's built-in generation check uses the supplied catalogue; layout knowledge/defaults, `keepsState`, bound-panel availability/context and shell contribution/factory inputs follow it. The contribution/instance catalogue implementations, normal IDs/order/metadata/binding contexts, `panels.bindings`, `panels.setBinding`, `authoring.historyScopes()` and `history.selectScope` stay unchanged. Frozen parity includes catalogue and binding owners/panel keys. No component library or guide source changes.

The returned lifetime accepts an upstream AbortSignal and aborts on non-persisted pagehide/start failure. The signal reaches existing experiment, migration/load, registered preview and bootstrap lifetimes. This is wiring, **not coordinated release proof**. Slice 13c still owns all remaining listeners/timers/workers/GL/subscriptions/jobs, partial-start cleanup, late-publication refusal and observed counts returning to baseline without destroying the page. Slice 13d owns mounted synthetic panel/editor/Undo/file substitution, mechanical feature/composition-only integration and retained-consumer closure.

## Gates

All heavy jobs run sequentially under the full-path Python memory guard, limit 4 GB. No Fabric quiet window was relayed. Chrome skips are not passes.

| Gate | Result |
|---|---|
| Pre-edit baseline on `c0378c9c` | 1 pass, 1 snapshot, 1 assertion; 0.0 GB reported peak. The first harness attempt called an unavailable registry method; corrected before production edits |
| Authoring check | All four TypeScript projects pass; final peak 1.7 GB |
| Focused compatibility | Initial broad run: 653 pass, 5 skip, 1 boundary failure, 66 files, 17 snapshots, 94,568 assertions; 1.5 GB peak. Strict root `.live` lookup moved into its registered helper and the supplied-surface source assertion migrated. Correction: 56 pass / 4 files / 549 assertions / 1 snapshot, 0.4 GB peak. Final unique focused coverage after the added capture regression: **655 pass, 5 skip, 0 unresolved fail across 66 files** |
| Final capture/workspace/migration/boundary follow-up | **103 pass, 2 Chrome skips, 0 fail**, 11 files, 912 assertions, 1 matching startup snapshot; 0.9 GB peak |
| New startup proof | **6 offline passes**, plus **2 clean Chrome skips**, across 3 new files; selection/isolation, empty catalogue/layout/session, starter compatibility, neutral capture mapping and frozen normal parity |
| Browser build | All 5 entries build, including after the final capture fix; 0.0 GB reported peak |
| Style-guide build/test | Build succeeds; **10 pass, 0 fail, 65 assertions**, 0.0 GB reported peak. `public/style-guide.html` is unchanged |
| Desktop-local check | Pass with the matching Electrobun devkit; 1.0 GB peak |
| Desktop-local tests | **133 pass, 11 skip, 0 fail**, 20 files, 910 assertions, 20.51 s; 0.6 GB peak |
| 038 quick harness | **11 pass, 0 fail**, 4 files, 46 assertions, 123.24 s; 1.9 GB peak |
| Five-batch suite | **4,534 pass, 185 skip, 0 fail**, 533 tracked files, latency withheld. Per-batch pass/fail/skip: **978/0/17, 909/0/18, 966/0/13, 961/0/3, 720/0/134**. Peaks **1.1/2.5/2.2/1.6/1.3 GB**. One complete batched run; no floor/limit kill or batch retry |
| Unique executed authoring coverage | The batching script uses `git ls-files`, so add the 3 new files' 6 passes and 2 skips exactly once: **4,540 pass, 187 skip, 0 unresolved fail across 536 executed files**, plus the separately withheld latency file. Desktop tests above overlap these batches; 038 is separate |
| Latency, fresh process last | **LOAD-BLOCKED, not run:** GetSystemTimes **66.6% CPU**, above the 60% ceiling. Unchanged 4 ms budgets; no p95 or low-load retry claimed |
| Repository checks | **0 broken links/source paths across 501 tracked Markdown files**, **0 tracked-text private-path findings**; all **8 new files** have **0 privacy/whitespace/link/source findings**. Existing snapshots have no diff; `git diff --check` clean |

The final neutral-capture regression first reproduced this slice's wrong field mapping. The composer now maps document `features`/`locked` to workspace `liveFeatures`/`liveLocked`, preserving feature-wide preferences and exact normal serialization. Some early batch processes predate that correction; their unchanged released-path results are retained, and the affected capture/workspace/migration/boundary paths plus authoring check/browser build were verified afterward. No existing expected snapshot or threshold was relaxed. The final latency process ran after these functional/build gates.

The five environment-sensitive Inno Setup install-outcome cases skip separately because the pinned compiler is absent:

- installed facts and Electrobun's closing error determine success;
- outcome exit codes, headings and next steps;
- output phases and closing-error names;
- installed-build and uninstall-entry identity;
- Microsoft Store private storage versus real local AppData.

The sixth Windows physical-path lookup case also skips. The other five desktop skips are optional native/packaging/installed-refresh oracles; the temporary HKCU uninstall-entry fixture is denied here. No skip is counted as a pass.

## Parity and compatibility

Before production edits, `core-startup-parity.test.ts` captured unchanged `c0378c9c` output. Its single snapshot is **271,259 bytes**, SHA-256 **`38072be50b2cf4d466af6bada1b57629357a50e03999347db9ecf932e1e4c2c9`**. It now reads the actual supplied normal startup composition/load adapter and matches without snapshot updates. It freezes registry/async descriptors, module/product data, view contributions/catalogue and binding owners/panel keys, renderer/surface/face-pose owners, defaults, fragment knowledge, fresh serialized workspace, migration/session output and starter defaults/data. The initial neutral-loader mismatch was corrected by the registered released projection; expected output was not changed.

Existing CORE-03 goldens stay unchanged and pass in the focused run. SHA-256 below normalizes CRLF to LF where present; the new startup snapshot already uses LF.

| Snapshot | SHA-256 (LF) | Coverage |
|---|---|---|
| `core-product-parity.test.ts.snap` | `97afc5de336b0760c6699f4f904e1052f6ed91cb5d4440fb6e40472b2eef29ec` | Document/history/geometry, captured point/field/array identities, same-look sharing and A/B/A stale runs |
| `core-file-export-parity.test.ts.snap` | `91776acef45b7c0cf506c7e213c6bb3c1585727f41442a0fb3532d8f5612a795` | Portable bytes/names/refusals, collections/compiler plan, Check/Build payloads and real partial omissions |
| `core-viewport-parity.test.ts.snap` | `053a596936ce05af98fd1c0b9ac81233fd89152d9a0e8c0bb3bfc511b39d226b` | Bound UV navigation/selection, independent gesture commit/Escape and release |
| `core-preview-parity.test.ts.snap` | `d08aafdc22af193b07683329670dd8bdc6cd0fc0b81adc60eaec9e0f298ed342` | Prepared assets/manifest/cache keys, worker pixel hashes and preview/warm/superseded publication |
| `core-context-parity.test.ts.snap` | `ce159a33b48fc3cd9639135b4524525746a2225589ad3f3b50719a00d76e2814` | Context candidates/popovers, hints, cursors and rendered labels |
| `core-guidance-parity.test.ts.snap` | `4d946713a250079eeed320adfddfb315c979b0ff462eca24651bb99bed6379ec` | Guidance/Help text, anchors and controllers |
| `core-placement-parity.test.ts.snap` | `27bb854c975e26d588d5cf6c3e92acea3b11ab3bd0a42ac25a024ca6058baa1d` | Product/framework/install defaults, identities and compatibility wording |

The Windows checkout's raw hashes differ only in line endings for product (`1c565b99e8b6e1b99a710c93016081b7413500aa524324392d8053f088add06c`), viewport (`4218497cc20c45418ec064011858c7dc7ba98acb9c1469c33813f031a973aa61`) and preview (`9f511a4a541a265fb32fe79d0d321091f6a425b150e9c6ecc0a696f279c9b08d`). There is no diff in an existing snapshot.

## Browser and GPU handoff

From `projects/xf-studio/authoring`, with `CHROME` pointing at an available Chrome (remove an inherited unavailable override):

```powershell
$env:XFS_REQUIRE_ORACLES = '1'
& "$env:LOCALAPPDATA/Python/pythoncore-3.14-64/python.exe" ../../../tools/memory_guard.py --limit 4 -- bun test --timeout 180000 tests/core-startup-browser.test.ts
```

The test allocates a transient port, starts the real server through the existing CDP harness with disposable empty settings/library/cache paths, and launches the real public entry twice, each on its own isolated host/profile. It waits for real startup completion and two animation frames, decodes the CDP-composited PNG and compares header/workspace/status and control pixels against a hidden-shell background. Commands, New tab and a dock menu must be visible and unobscured. An independent capture with `.studio-ready` transparent must fail the same pixel gate even with the original DOM observations. It also checks paint timing, feature/module/starter availability, isolated storage/routes and console errors, then the signal handle. It closes its own browser/server. It does not claim resource-count-baseline disposal proof. It skips without Chrome and fails for missing Chrome under `XFS_REQUIRE_ORACLES=1`.

For manual comparison on the coordinator's worktree server (substitute its transient port):

- `http://127.0.0.1:<port>/?verify=1&composition=normal`: unchanged Studio catalogue/default arrangement, makeup/UV/starter controls and existing features. With empty settings, the normal first-run preview setup appears; with prepared game assets, the existing V preview should draw unchanged.
- `http://127.0.0.1:<port>/?verify=1&composition=empty`: shell panels arranged from their slots, 3D/setup and platform controls; no makeup panels/UV/starter contribution or part-less module panels. Use a fresh verification workspace/profile for a clean factory arrangement; existing unknown authored data/layout entries remain preserved.

Run the standard WebGL set, both dock-strip geometry tests, tree-view geometry and layout-tabs timing. Most directly affected rows: initial startup/default layout and catalogue/instance binding, neutral/normal preview availability, first preparation/draw and renderer/surface/face-poser lists, raster/guide identity, A/B/A and warm returns, cancellation/rehost/context restoration. Core renderer algorithms/components are unchanged; those are regression gates, not newly claimed results.

In normal `?verify=1`, compare light/dark narrow/wide layouts and restored current/legacy workspace/collections; two differently bound UV/3D/inspector panels versus same-look sharing; gestures/controls/one-step Undo/Escape; scoped History selection and A/B/A stale captures; starter/default persistence; import/export/mask/Check/Build; close/reopen/rehost/reload. Confirm binding/history IDs and saved content. No game test is needed. Independent code review and any visual PASS remain coordinator-owned.

## Changed files and footprint

The initial slice-13b checkpoint had 28 changed/new files, with paths below `projects/xf-studio/authoring` unless stated:

| Area | Files |
|---|---|
| Real root/composition | `src/compose/studio-startup.ts`, `studio-main.ts`, `studio-registry.ts`, new `startup-composition.ts`, `layout-defaults.ts`, `module-services.ts` |
| Registered starters | new `src/app/starters/feature-starters.ts`, `layered-starters.ts` |
| Neutral workspace compatibility | `src/app/browser/browser-workspace-device.ts`, `profiles-migration-device.ts`; `src/app/workspace/makeup-workspace.ts`, `workspace-composer.ts`; `src/app/profiles/profiles-migration.ts`, `profiles-migration-data.ts`, `profile-window.ts` |
| Shared preview input types | `src/app/trusted-preview-services.ts`, `src/preview/browser/browser-head-attachment.ts` |
| New proof | `tests/core-startup-composition.test.ts`, `core-startup-parity.test.ts`, `core-startup-browser.test.ts`, `tests/__snapshots__/core-startup-parity.test.ts.snap` |
| Existing boundary assertions | `tests/architecture-import-boundary.test.ts`, `profiles-no-default-boundary.test.ts` |
| Repository records | `research/authoring/core-03-plan.md`, `code-health.md`, `ui-architecture-boundary.md`, this report; `research/backlog/README.md` |

The checkpoint footprint reported **214.2 GB free on C**; wrap-up reports **211.2 GB free** (the guarded footprint job peaked at 0.0 GB). This task retains no payload above 5 GB. All owned scratch was removed: **31 files, 371,349 bytes and 2 empty directories**, with **zero reparse points and zero remaining owned targets**. These were `local/core-03-s13b/`, its six sibling task scripts, `projects/xf-studio/authoring/local/core-03-s13b/` and eight sibling task logs/manifests. No junction was created or removed. Unique parity evidence and gate accounting remain in the candidate snapshot, plan and this report; no owned gate child process remains.

The maintainer committed that checkpoint as `b3edc0cf` on `claude/core-03`, rebased onto main `d40e5563`, including main's `[...list].sort()` Linux ordering fix. No `.toSorted()` was introduced; new multi-item name-list comparisons do not rely on readdir order.

## Review corrections (29 October 2026)

Both Medium findings are corrected in the uncommitted follow-up. `initialLayout()` only aliases an existing first view to `head`; a viewless first default retains its own dock and origin. The Save Explorer-first regression reproduced the reported `views[0].key` exception before the fix, then passed with its exact default and successful session construction. Normal and empty composition policy, P3-v wiring, stored IDs and all parity snapshots are unchanged.

The browser gate now uses the existing PNG decoder and a hidden-shell reference, requiring at least 0.5% of each measured area with an RGB difference above 12. The minimum is 24 pixels for a region and 8 for a control, scaled by device pixel area so the real dock menu's sparse three-square icon can pass. DOM checks include ancestor display/visibility/opacity, viewport intersection and control hit testing. Its automated negative control hides the mounted shell with `opacity: 0 !important`, captures it independently, and expects the same pixel assertion to fail while retaining the original DOM/geometry observations. The injected style is removed in `finally` after each hidden capture. This live browser proof is prepared for the coordinator, **not run in the sandbox**.

Targeted validation, one guarded Bun process at a time: the pre-fix composition run had **5 pass, 1 expected regression failure**. After the fix, **10 pass, 0 skip, 0 fail across two files**, 55 assertions; guard peak rounded to 0.0 GB. The four decoded-image tests cover device scaling, the sparse real menu icon, a blank capture, a boot message alone, missing region pixels, hidden controls and missing control pixels.

```powershell
& "C:/Users/Nathan/AppData/Local/Python/pythoncore-3.14-64/python.exe" D:/Dev/cp2077-modding-hq/tools/memory_guard.py --limit 4 -- bun test tests/core-startup-composition.test.ts tests/core-startup-paint.test.ts
```

Review changes: `src/compose/layout-defaults.ts`, `tests/core-startup-composition.test.ts`, `tests/core-startup-browser.test.ts`, new `tests/core-startup-paint.test.ts` and `tests/fixtures/startup-paint.ts`, plus this report and the plan. The coordinator owns the browser run (command above in Browser and GPU handoff), authoring check, batches, desktop and 038 gates under the new handle-investigation restriction; none of those were run for this follow-up. The read-only footprint report has **209.8 GB free on C** (0.0 GB guard peak under 1 GB), with no new task payload above 5 GB. No scratch or capture files were created; all guarded jobs have exited.

**Knowledge used:** knowledge index; CORE-03 plan and all as-built notes, slice-13a report and retained-consumer context; architecture contract and UI architecture boundary; view-graph design, editor invariants and developer orientation/test helpers; project status/backlog and project README. No game-engine knowledge page was contradicted or new runtime finding observed. The current construction/startup proof table and boundary record are updated; browser mount/paint/dispose remains explicitly unproven here.
