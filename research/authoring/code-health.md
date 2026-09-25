# Code health ledger

The code and architecture must stay clean enough that the long roadmap (V customisation, then body, then world tools) keeps moving forward instead of looping on bug fixes. This ledger drives threshold-triggered deep reviews. Routine merge gates (tests, typechecks, [architecture boundary tests](architecture-contract.md), link check, coordinator diff read) run on every merge regardless.

## Review triggers

Run `python tools/review_due.py` after each merge into `main`. A deep review is due when **any** of these holds since the last reviewed commit below:

- **Merges:** 5 or more merged feature branches.
- **Changed lines:** 4,000 or more lines of TypeScript/Python source under `projects/` (tests and generated files excluded).
- **New subsystem:** a new top-level module family or host capability landed. Record it by hand in the table below.
- **Boundary exception:** a new exception was added to the [UI architecture boundary](ui-architecture-boundary.md).
- **Release:** a release tag is about to be created.

## How a deep review runs

- **Reviewers:** independent, read-only reviewers work in parallel by area, typically (1) domain and application core, (2) pipeline, resolver and host adapters, and (3) presentation and desktop.
- **Checks:** conformance to the architecture contract, duplication and dead code, coupling and layering, complexity hotspots, test gaps, error and cancellation handling, and whether new code extends cleanly to later domains.
- **Findings:** each is recorded below with a severity.
  - **High:** a correctness bug, a broken or bypassed boundary, a security/data-loss risk, or a design that would force rework of later features.
  - **Medium:** maintainability debt that will slow the next features.
  - **Low:** polish.

## Debt budget

Reviews never block feature work directly. Fixes run as a parallel cleanup track. **If more than 3 High findings are open, feature merges pause** until the count is back to 3 or fewer; cleanup and critical-path fixes may still merge.

## Last reviewed

| Commit (newest first) | Date | Scope | Result |
|---|---|---|---|
| `f3f7147` | 2026-09-25 | Focused review: game-asset export and derived 3D preview core | 1 High, 7 Medium, 8 Low (PREV-*). PREV-01/02/04/05/06 assigned to claude/wolvenkit-fetch. |
| `b9597bd` | 2026-09-25 | First deep review: core, pipeline/resolver/adapters, presentation/desktop (three parallel reviewers) | 7 High, 30 Medium, 18 Low. Over the High budget, so feature merges are paused except critical-path work. |

## Open findings

| ID | Severity | Area | Finding | Status |
|---|---|---|---|---|
| PIPE-01 | High | Pipeline | Built-in plate always cut from the vanilla head, not the head the game actually loads (head mods/patches) | **Fixed** (claude/cleanup-pipeline, 25 Sep) |
| PIPE-02 | High | Pipeline | Verifier trusts builder-produced roundtrip/export files; not data-independent; `.xl` only substring-checked | **Fixed** (claude/cleanup-pipeline, 25 Sep) |
| UI-01 | High | Desktop | Damaged/incompatible `workspace.json` bricks the desktop app; window can't close | Fixing: alpha readiness |
| UI-02 | High | Rendering | Renderer hard-codes brow/lash identities and per-mod manifests; resolver output not connected to rendering | Partly fixed: core head/plate/eyes load through one typed render record; brows/lashes/hair/piercings follow-on |
| CORE-01 | High | Core | Autosave loop: save status re-triggers persist every ~180 ms with no edits | **Fixed** (claude/cleanup-core, 25 Sep) |
| CORE-02 | High | Core | Workspace exceeds browser storage (~5 MB) with realistic histories; autosave silently stops | **Fixed** (claude/cleanup-core, 25 Sep) |
| CORE-03 | High | Core (design) | Presets/Undo/routing only understand eye-makeup recipes; needs domain registry + general preset model before CC controls | Designed: [feature-module platform](feature-module-platform.md); implementation scheduled |
| PREV-01 | High | Preview export | Incomplete WolvenKit exports cached as complete; preview permanently stuck until the game changes | Fixing: claude/wolvenkit-fetch |
| PREV-02 | Med | Preview export | Export/preview cache keys ignore WolvenKit identity and GLB/material hashes | Fixing: claude/wolvenkit-fetch |
| PREV-03 | Med | Preview export (design) | Material chains resolved by WolvenKit's view of the game folder, not the resolver's winning archives | Open (platform step 7) |
| PREV-04 | Med | Preview export | Catch-all blames WolvenKit for cache/disk/JSON errors | Fixing: claude/wolvenkit-fetch |
| PREV-05 | Med | Preview export | 'Head missing' inferred from missing outputs; tool failure misreported as blocked | Fixing: claude/wolvenkit-fetch |
| PREV-06 | Med | Preview export | Duplicated WolvenKit runner (sixth invocation path) with preview-specific errors | Fixing: claude/wolvenkit-fetch |
| PREV-07 | Med | Preview export | Exporter not a shared host service; no single-flight or cross-process guard | Open |
| PREV-08 | Med | Rendering (design) | Render record is a closed core-head shape; no cancellation/release; material templates unused | Open (platform step 7) |
| PIPE-03 | Med | Pipeline | Localhost and desktop Build host services drifted (cancellation, deadlines, error codes, result gate) | Open |
| PIPE-04 | Med | Resolver | Resolver WolvenKit runner: no timeout/exit check, poisoned promise chain, non-atomic cache, cache not keyed by WolvenKit version | Open |
| PIPE-05 | Med | Pipeline | Readiness and diagnostic tools hard-code MO2 mods/profiles dirs | Open |
| PIPE-06 | Med | Resolver | Five implementations of virtual-file precedence with different semantics | Open |
| PIPE-07 | Med | Pipeline | Five WolvenKit invocation paths; version not recorded in manifest | Open |
| PIPE-08 | Med | Pipeline | Eight inconsistent path-containment helpers | Open |
| PIPE-09 | Med | Pipeline | No single typed package manifest schema/parser | Open |
| PIPE-10 | Med | Pipeline | Two MO2 journal/rollback engines and four modlist parsers | Open |
| PIPE-11 | Med | Resolver | Per-mod intake paths/manifests bypass the resolver (PRC, lash, hair, brow, eyes) | Open (follows UI-02) |
| PIPE-12 | Med | Pipeline (design) | Build, inventory and verifier shaped for one product; need a mod-product descriptor before a second exporter | Open |
| PIPE-13 | Med | CI | Authoring suite not run in CI on pushes to main; oracle/integration tests skip silently | **Fixed** (claude/cleanup-pipeline, 25 Sep) |
| PIPE-14 | Med | Pipeline | process-tree and WolvenKit error paths untested | Open |
| UI-03 | Med | Presentation | Two setup forms with separate settings state (stale Build availability, conflicting revisions) | Open (settings v2 track) |
| UI-04 | Med | Desktop | Desktop bootstrap is a second untyped, untested UI | Open |
| UI-05 | Med | Presentation | Startup wiring duplicated in studio-main, port-smoke and main | Open |
| UI-06 | Med | Presentation | Desktop decisions leak into shared startup via data attributes; raw error text shown | Open |
| UI-07 | Med | Desktop | Build readiness probes block the server synchronously | Fixing: alpha readiness |
| UI-08 | Med | Desktop | Build failure details only in console | Fixing: alpha readiness |
| UI-09 | Med | Desktop | Desktop autosaves queue instead of replacing | Fixing: alpha readiness |
| UI-10 | Med | Presentation | UI re-implements domain rules (satin alias, glitter model IDs, eye-shape list, limits) | Open |
| UI-11 | Med | Rendering | scene.ts 893-line monolith, no dispose, renders every frame, leaks on load failure | Open |
| UI-12 | Med | Tests | UI/desktop test gaps (bootstrap, panels, dock DOM, startup) | Open |
| CORE-04 | Med | Core | Undo at the history limit mislabels entries and creates no-op entries | **Fixed** (claude/cleanup-core, 25 Sep) |
| CORE-05 | Med | Core | Queries deep-copy/reparse the collection (context menu 0.1–0.4 s) and some stash as a side effect | Open |
| CORE-06 | Med | Core | Control edits skip validation and throw raw errors, leaving a transaction open | **Fixed** (claude/cleanup-core, 25 Sep) |
| CORE-07 | Med | Core | Optical-bake and range rules duplicated across core, workers and descriptors | Open |
| CORE-08 | Med | Core | Duplicate action catalogues and Undo policies; finish choices not from the catalogue | Open |
| CORE-09 | Med | Core (design) | One layer's glitter model bumps the whole recipe schema; nested schema conditionals | Open |
| CORE-10 | Med | Core | One damaged recovery draft blocks the whole workspace restore | **Fixed** (claude/cleanup-core, 25 Sep) |
| CORE-11 | Med | Tests | Core test gaps (startup wiring, history limit, workspace size, routing) | Partly fixed (claude/cleanup-core); routing tests remain |

**Low findings** (picked up opportunistically). Paths are relative to `projects/xf-studio/authoring`.

- **PREV-09..16** (preview export, 25 Sep focused review): silent fallback to unhashed prepared files; host precedence drift; non-atomic cache write; no cache eviction or work-folder sweep; duplicate fingerprints; synchronous hashing on the request path; readiness passed via data attributes; test gaps (loader, error mapping, cache reuse).

- **PIPE-15:** a candidate that fails the second result gate stays in `package-candidates/` (`desktop/build.ts:206-212`).
- **PIPE-16:** plate input hashes aren't compared start vs end, and the verifier hard-codes 105 morphs. Being fixed in cleanup-pipeline.
- **PIPE-17:** `reg.exe` output is decoded as UTF-8, and process output is decoded per chunk (multi-byte splits).
- **PIPE-18:** error codes are mapped by matching message prefixes; needs a typed `PackageFilterError`.
- **PIPE-19:** stale comments in `mod-branding.ts` and `eye-plate-cache.ts` (the publish race comment).
- **PIPE-20:** plate derivation parses large JSON on the host event loop; move it to a worker.
- **PIPE-21:** selector indices shift when presets are omitted; save behaviour unproven. Add to the in-game test card.
- **PIPE-22:** the game-folder ArchiveXL bundle is listed non-recursively and outside source discovery.
- **UI-13:** "autosaved in this browser" wording on desktop, and technical jargon in panels. Being fixed in alpha readiness.
- **UI-14:** the command palette recomputes every command's availability per keystroke.
- **UI-15:** theme and lighting actions ignore failures and bypass `rt.dispatch`.
- **UI-16:** no CSP or navigation guard; wrong status code (403 vs 415); "spike" identifiers remain. Being fixed in alpha readiness.
- **UI-17:** `desktop/update-electrobun.ts` is dead and unchecked; two TypeScript versions (5.9.3 vs 7.0.2).
- **UI-18:** `about.css` and boot-watchdog styles aren't tokenised; duplicate font-size tokens; palette input has `outline:none`.
- **CORE-12:** a fresh workspace opens the oldest collection and adds an "Unsaved preset".
- **CORE-13:** dead history helpers; glitter measurements never pruned and keyed by layer IDs that repeat across presets; wrong import consequence text.
- **CORE-14:** confusing names (`selectedCollection` returns a preset ID); `ReadonlyDeep` defined three times; shared mutable `glitterChoices`; stale test counts in the boundary doc.
- **CORE-15:** preview reports ready for one frame after an edit; geometry cache recopies on double updates; reason codes come from matching message text.

## New subsystems since last review

None since `f3f7147`.

## Fixed in claude/cleanup-core

- **CORE-01:** save status is published only on change, autosave watches content sources (`session.watch(bootstrap.collection)`) instead of the whole presentation port, and identical content is never rewritten. Test: `tests/workspace-persistence.test.ts` (fake timers, zero idle writes, resumes on edit).
- **CORE-02:** `workspace-budget.ts` bounds the stored workspace (2,000,000 code units per key; selected preset stored once with full Undo, others 5 entries, removed and recovery entries without histories, progressive trimming) and publishes `nearly-full`/`full`. A worst-case realistic workspace (6 eight-layer presets, 80 Undo entries each, 20 removed presets and 4 recovery drafts all with histories, 123M code units verbatim) stores in 1.81M at the standard level. Desktop follow-up: the storage shim should save the host file independently of `localStorage` quota errors, and may pass a larger budget.
- **CORE-10:** damaged recovery drafts and removed presets are dropped with a warning (`repaired` status); only the current draft must parse.
- **CORE-04:** checkpoints return the entry they added; transactions label and discard that entry, and the displaced oldest entry returns when an entry is discarded or undone. Test: `tests/history-limit.test.ts`.
- **CORE-06:** `capability()` applies descriptor payload ranges, `controlEdit` runs the same gate and returns a typed result, exceptions are classified by source, and control dispatch is wired inside `createTrustedAuthoringCore`. Test: `tests/control-edit-validation.test.ts`.
- **CORE-11 (partial):** the tests above, plus touched fixtures (`studio-application`, `alpha-capability-reasons`, `application-boundary-fixture`) now build through `createTrustedAuthoringCore`.

## Fixed in claude/cleanup-pipeline

- **PIPE-13:** a new Authoring workflow runs `bun test`, `bun run check` and `bun run build` on Ubuntu and the desktop typecheck (Electrobun devkit) and `bun test tests` on Windows for pushes to `main` and pull requests touching the authoring source. `XFS_REQUIRE_ORACLES=1` turns oracle, game-integration and declared private-asset skips into failures for release runs.
- **PIPE-02, PIPE-16:** the independent verifier unbundles its own copy of the archive, checks every member hash, then runs its own WolvenKit serialize and texture export on those members and the plate inputs; it parses the `.archive.xl` structurally, re-hashes plate inputs at the end, and takes the morph target count from the plate recipe. The builder no longer writes the round trip or texture export.
- **PIPE-01:** the built-in plate is cut from the head the launch route loads (generic resolver plus `.xl` patches), with topology gates, provenance in the plate and package manifests, a cache key over that provenance, a named `plate_source_modded` stop and the `XFS_EYE_PLATE_HEAD=base-game` escape hatch.

## Fixed in claude/retire-legacy

- **UI-05:** one composition root, `src/studio-startup.ts`, started by the localhost entry `studio-main.ts` and by the desktop bootstrap (which now bundles `studio-startup.js` instead of `studio-main.js`). The sidebar shell (`main.ts`, `/legacy.html`, `style.css`, eleven `*-ui.ts` modules), `/port-smoke.html` and `/application-boundary-fixture.html` were removed; `tests/trusted-studio-bootstrap.test.ts`, `tests/studio-presentation.test.ts` and `tests/studio-application.test.ts` remain the page-free port fixtures. Legacy-only `preset.expand`/`collection.filesOpen`, the workspace `panels` block, draft `expanded`/`filesOpen` flags, `captureBrowserPanels`, `setupContextMenus` and the editors' keyword-cursor fallback went with it; stored workspaces with those fields still restore (fields ignored).
- **UI-06 (data attributes):** host differences reach the root as a typed `StudioHost` (storage, budget, preparation service, shared `LocalSetupActions`, setup place, flush and preview-ready callbacks); `tests/studio-ui-boundary.test.ts` fails if the root or entry reads `dataset`, `xfDesktop*` or `xfs-desktop*`. The desktop smoke report uses the ready callback. Boot and head-load failures show plain sentences; raw error text remains only after "The 3D preview couldn't be loaded:" for loader messages, which are already plain.
- **PREV-09 and the prepared-file path:** the core head, plate, eyes and maps come only from the derived game-file preview on both hosts. Removed: localhost prepared-file precedence and `XFS_PREVIEW_CORE=derived`, the desktop five-file intake (`desktop/asset-intake.ts`, marker, dialog, endpoint, trial scripts, `review-ready-assets.ts`), `tools/export_preview.py`, the unhashed prepared render record and the prepared-eyes notice. Render records must be `game-files` with hashes and morph sources. The preparation card (`src/browser-preview-card.ts`) is shared, so localhost with no cache offers preparation from the saved settings. Real-geometry tests read the derived head and skip with a reason when no preview is prepared.
