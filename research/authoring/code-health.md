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

| Commit | Date | Scope | Result |
|---|---|---|---|
| `b9597bd` | 2026-09-25 | First deep review: core, pipeline/resolver/adapters, presentation/desktop (three parallel reviewers) | 7 High, 30 Medium, 18 Low. Over the High budget, so feature merges are paused except critical-path work. |

## Open findings

| ID | Severity | Area | Finding | Status |
|---|---|---|---|---|
| PIPE-01 | High | Pipeline | Built-in plate always cut from the vanilla head, not the head the game actually loads (head mods/patches) | Fixing: claude/cleanup-pipeline |
| PIPE-02 | High | Pipeline | Verifier trusts builder-produced roundtrip/export files; not data-independent; `.xl` only substring-checked | Fixing: claude/cleanup-pipeline |
| UI-01 | High | Desktop | Damaged/incompatible `workspace.json` bricks the desktop app; window can't close | Fixing: alpha readiness |
| UI-02 | High | Rendering | Renderer hard-codes brow/lash identities and per-mod manifests; resolver output not connected to rendering | Partly fixed: core head/plate/eyes load through one typed render record; brows/lashes/hair/piercings follow-on |
| CORE-01 | High | Core | Autosave loop: save status re-triggers persist every ~180 ms with no edits | **Fixed** (claude/cleanup-core, 25 Sep) |
| CORE-02 | High | Core | Workspace exceeds browser storage (~5 MB) with realistic histories; autosave silently stops | **Fixed** (claude/cleanup-core, 25 Sep) |
| CORE-03 | High | Core (design) | Presets/Undo/routing only understand eye-makeup recipes; needs domain registry + general preset model before CC controls | Designed: [feature-module platform](feature-module-platform.md); implementation scheduled |
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
| PIPE-13 | Med | CI | Authoring suite not run in CI on pushes to main; oracle/integration tests skip silently | Fixing: claude/cleanup-pipeline |
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

- Generic game asset export (`game-asset-export*.ts`) and the derived 3D preview core (`preview-core-*.ts`, `render-detail.ts`, `core-detail-loader.ts`, desktop `preview-preparation.js`), 25 September 2026.

## Fixed in claude/cleanup-core

- **CORE-01:** save status is published only on change, autosave watches content sources (`session.watch(bootstrap.collection)`) instead of the whole presentation port, and identical content is never rewritten. Test: `tests/workspace-persistence.test.ts` (fake timers, zero idle writes, resumes on edit).
- **CORE-02:** `workspace-budget.ts` bounds the stored workspace (2,000,000 code units per key; selected preset stored once with full Undo, others 5 entries, removed and recovery entries without histories, progressive trimming) and publishes `nearly-full`/`full`. A worst-case realistic workspace (6 eight-layer presets, 80 Undo entries each, 20 removed presets and 4 recovery drafts all with histories, 123M code units verbatim) stores in 1.81M at the standard level. Desktop follow-up: the storage shim should save the host file independently of `localStorage` quota errors, and may pass a larger budget.
- **CORE-10:** damaged recovery drafts and removed presets are dropped with a warning (`repaired` status); only the current draft must parse.
- **CORE-04:** checkpoints return the entry they added; transactions label and discard that entry, and the displaced oldest entry returns when an entry is discarded or undone. Test: `tests/history-limit.test.ts`.
- **CORE-06:** `capability()` applies descriptor payload ranges, `controlEdit` runs the same gate and returns a typed result, exceptions are classified by source, and control dispatch is wired inside `createTrustedAuthoringCore`. Test: `tests/control-edit-validation.test.ts`.
- **CORE-11 (partial):** the tests above, plus touched fixtures (`studio-application`, `alpha-capability-reasons`, `application-boundary-fixture`) now build through `createTrustedAuthoringCore`.
