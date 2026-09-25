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
| `ecb4b33` | 2026-09-25 | Release-trigger review before `v0.1.0-alpha.1`: new 3D preview setup service, and release readiness (workflow, versions, changelog, notices, site, packaging, CI) | 0 High, 1 Medium (PREV-20), 8 Low. Release blockers: Desktop release workflow never run; changelog claims features not in the release. Fixed in claude/release-prep (PREV-20..24, UI-34/35, REL-01; PREV-25 partly; changelog and site corrected); the workflow's first run failed on a test timeout, fixed there, rerun pending |
| `524a575` | 2026-09-25 | Pre-alpha review of presentation, startup, preview card and desktop host at `7e02636` (completes the `19bf84c` deep review after the legacy-shell removal); the core and pipeline cleanups merged since fix reviewed findings | 0 High, 7 Medium, 6 Low (UI-21..33); UI-05 fixed, UI-06 mostly fixed. Alpha blockers UI-19/20/21/22/23/24/25/27 assigned to claude/alpha-polish |
| `19bf84c` | 2026-09-25 | Deep review (10 merges, ~7,000 lines): domain core, and pipeline/verifier/hosts incl. WolvenKit download (two parallel reviewers). Presentation deferred to after the legacy-shell removal merges | 1 High (CORE-16), 8 Medium, 13 Low. PREV-01/02/04/05/06, PIPE-02/16 and UI-07 confirmed fixed. Fixes run in claude/cleanup-pipeline2 and claude/cleanup-core2 |
| `f3f7147` | 2026-09-25 | Focused review: game-asset export and derived 3D preview core | 1 High, 7 Medium, 8 Low (PREV-*). PREV-01/02/04/05/06 assigned to claude/wolvenkit-fetch. |
| `b9597bd` | 2026-09-25 | First deep review: core, pipeline/resolver/adapters, presentation/desktop (three parallel reviewers) | 7 High, 30 Medium, 18 Low. Over the High budget, so feature merges are paused except critical-path work. |

## Open findings

| ID | Severity | Area | Finding | Status |
|---|---|---|---|---|
| PIPE-01 | High | Pipeline | Built-in plate always cut from the vanilla head, not the head the game actually loads (head mods/patches) | **Fixed** (claude/cleanup-pipeline, 25 Sep) |
| PIPE-02 | High | Pipeline | Verifier trusts builder-produced roundtrip/export files; not data-independent; `.xl` only substring-checked | **Fixed** (claude/cleanup-pipeline, 25 Sep) |
| UI-01 | High | Desktop | Damaged/incompatible `workspace.json` bricks the desktop app; window can't close | **Fixed** (claude/alpha-readiness, 25 Sep) |
| UI-02 | High | Rendering | Renderer hard-codes brow/lash identities and per-mod manifests; resolver output not connected to rendering | Partly fixed: core head/plate/eyes load through one typed render record; brows/lashes/hair/piercings follow-on |
| CORE-01 | High | Core | Autosave loop: save status re-triggers persist every ~180 ms with no edits | **Fixed** (claude/cleanup-core, 25 Sep) |
| CORE-02 | High | Core | Workspace exceeds browser storage (~5 MB) with realistic histories; autosave silently stops | **Fixed** (claude/cleanup-core, 25 Sep) |
| CORE-03 | High | Core (design) | Presets/Undo/routing only understand eye-makeup recipes; needs domain registry + general preset model before CC controls | Designed: [feature-module platform](feature-module-platform.md); implementation scheduled |
| CORE-16 | High | Core | `selectGlitterModel` doesn't know `xfs/recipe-11`: choosing Fine/Clustered/Direct Glitter beside a game-matched Glossy/Shimmer layer is offered then refused, or silently downgrades the schema (`glitter-model.ts:62-65`, `recipe-actions.ts:178-180`). CORE-09 made worse | **Fixed** (claude/cleanup-core2, 25 Sep) |
| PREV-01 | High | Preview export | Incomplete WolvenKit exports cached as complete; preview permanently stuck until the game changes | **Fixed** (claude/wolvenkit-fetch, 25 Sep) |
| PREV-02 | Med | Preview export | Export/preview cache keys ignore WolvenKit identity and GLB/material hashes | **Fixed** (claude/wolvenkit-fetch, 25 Sep) |
| PREV-03 | Med | Preview export (design) | Material chains resolved by WolvenKit's view of the game folder, not the resolver's winning archives. Worse since PIPE-01: Build cuts the plate from the head the launch route loads, while the preview still reads only `archive/pc/content` (`preview-core-recipe.ts:32` comment claims they share one head) | Open (platform step 7); the comment is corrected (claude/cleanup-pipeline2); a preview notice is still to add |
| PREV-04 | Med | Preview export | Catch-all blames WolvenKit for cache/disk/JSON errors | **Fixed** (claude/wolvenkit-fetch, 25 Sep) |
| PREV-05 | Med | Preview export | 'Head missing' inferred from missing outputs; tool failure misreported as blocked | **Fixed** (claude/wolvenkit-fetch, 25 Sep) |
| PREV-06 | Med | Preview export | Duplicated WolvenKit runner (sixth invocation path) with preview-specific errors | **Fixed** (claude/wolvenkit-fetch, 25 Sep) |
| PIPE-23 | Med | Pipeline | Colour-shift "one pigment" rule compares against all active layers, not exportable ones (`finish-export.ts:104`): a Colour-shifting layer plus a Glitter layer omits the whole preset | **Fixed** (claude/cleanup-pipeline2, 25 Sep) |
| PIPE-24 | Med | Verifier | Verifier takes each preset's route from the builder's `build.json` (missing counts as flat); a Shimmer preset compiled flat would pass every gate. Route isn't in the manifest | **Fixed** (claude/cleanup-pipeline2, 25 Sep) |
| PIPE-25 | Med | Pipeline/hosts | Every Build runs the full head-source resolver (source discovery, archive indexes, `.xl` files, head-archive hash) synchronously on the host, even when the plate is cached; extends PIPE-20 | Partly fixed (claude/cleanup-pipeline2): unchanged plate inputs skip extraction and hashing and archive hashes are memoised (about 7 s to 2 s on the reference route); route resolution itself still runs synchronously on the host each Build |
| RES-01 | Med | Resolver | When a creator switcher picks a non-default choice, the default choice's target stays active too (skin types 01 and 03 both active in test states); see [head CC render evidence](../character-customization/head-cc-render-evidence.md) | **Fixed** (claude/resolver-choices, 25 Sep): switcher targets take activation only from switchers, checked against all six vanilla UI presets |
| RES-02 | Med | Resolver | A "None" choice (e.g. no scar) yields an empty entry and a missing-appearance warning instead of nothing | **Fixed** (claude/resolver-choices, 25 Sep): a definition named `None` emits no descriptor |
| PREV-20 | Med | Presentation/startup | A head-load failure after the scene loads leaves head-bound wiring attached (theme binding, app attach, preview device, surface editor, controls listener) and `createScene` late errors leave an extra canvas; Try again then doubles them | **Fixed** (claude/release-prep, 25 Sep) |
| PREV-07 | Med | Preview export | Exporter not a shared host service; no single-flight or cross-process guard | Open |
| PREV-08 | Med | Rendering (design) | Render record is a closed core-head shape; no cancellation/release; material templates unused | Open (platform step 7) |
| PIPE-03 | Med | Pipeline | Localhost and desktop Build host services drifted (cancellation, deadlines, error codes, result gate) | Open |
| PIPE-04 | Med | Resolver | Resolver WolvenKit runner: no timeout/exit check, poisoned promise chain, non-atomic cache, cache not keyed by WolvenKit version | Open |
| PIPE-05 | Med | Pipeline | Readiness and diagnostic tools hard-code MO2 mods/profiles dirs | Open |
| PIPE-06 | Med | Resolver | Five implementations of virtual-file precedence with different semantics | Open |
| PIPE-07 | Med | Pipeline | Five WolvenKit invocation paths; version not recorded in manifest | Partly fixed: Build, eye plate and preview share `wolvenkit-cli.ts`, and the preview records the WolvenKit version; the verifier now runs through it too (claude/cleanup-pipeline2); the resolver fetcher still spawns directly, and the package manifest does not record the version |
| PIPE-08 | Med | Pipeline | Eight inconsistent path-containment helpers | Open |
| PIPE-09 | Med | Pipeline | No single typed package manifest schema/parser | Open |
| PIPE-10 | Med | Pipeline | Two MO2 journal/rollback engines and four modlist parsers | Open |
| PIPE-11 | Med | Resolver | Per-mod intake paths/manifests bypass the resolver (PRC, lash, hair, brow, eyes) | Open (follows UI-02) |
| PIPE-12 | Med | Pipeline (design) | Build, inventory and verifier shaped for one product; need a mod-product descriptor before a second exporter | Open |
| PIPE-13 | Med | CI | Authoring suite not run in CI on pushes to main; oracle/integration tests skip silently | **Fixed** (claude/cleanup-pipeline, 25 Sep) |
| PIPE-14 | Med | Pipeline | process-tree and WolvenKit error paths untested | Partly fixed: the shared WolvenKit runner's success policy, runtime detection and identity are tested (`tests/wolvenkit-cli.test.ts`); process-tree itself is still untested |
| UI-03 | Med | Presentation | Two setup forms with separate settings state (stale Build availability, conflicting revisions) | Open (settings v2 track) |
| UI-04 | Med | Desktop | Desktop bootstrap is a second untyped, untested UI | Open |
| UI-05 | Med | Presentation | Startup wiring duplicated in studio-main, port-smoke and main | **Fixed** (claude/retire-legacy, 25 Sep) |
| UI-06 | Med | Presentation | Desktop decisions leak into shared startup via data attributes; raw error text shown | Mostly fixed (claude/retire-legacy): typed host object; remaining raw error text is UI-22 |
| UI-07 | Med | Desktop | Build readiness probes block the server synchronously | **Fixed** (claude/alpha-readiness, 25 Sep) |
| UI-08 | Med | Desktop | Build failure details only in console | **Fixed** (claude/alpha-readiness, 25 Sep) |
| UI-09 | Med | Desktop | Desktop autosaves queue instead of replacing | **Fixed** (claude/alpha-readiness, 25 Sep) |
| UI-10 | Med | Presentation | UI re-implements domain rules (satin alias, glitter model IDs, eye-shape list, limits) | Open |
| UI-11 | Med | Rendering | scene.ts 893-line monolith, no dispose, renders every frame, leaks on load failure | Open |
| UI-12 | Med | Tests | UI/desktop test gaps (bootstrap, panels, dock DOM, startup) | Partly fixed (claude/alpha-polish): the 3D preview first run and startup failure paths are tested through the DOM-free setup service (`tests/preview-setup.test.ts`); the bootstrap, panels and dock DOM still have no behavioural tests |
| UI-21 | Med | Presentation | Preview preparation and WolvenKit setup reachable only through the standalone card; after "Not now" there is no way back until restart (not on the port; no boundary exception) | **Fixed** (claude/alpha-polish, 25 Sep) |
| UI-22 | Med | Presentation | Head-load failure after ready is latched: no retry, raw loader text shown (e.g. "geometry nodes are missing") | **Fixed** (claude/alpha-polish, 25 Sep) |
| UI-23 | Med | Presentation | Preparation/WolvenKit polling stops for good after one failed poll; the card freezes mid-step | **Fixed** (claude/alpha-polish, 25 Sep) |
| UI-24 | Med | Presentation | Every not-ready head state uses the error phase: normal preparation shows a red danger icon | **Fixed** (claude/alpha-polish, 25 Sep) |
| UI-25 | Med | Presentation | Game & tools and desktop Build setup show developer wording (revision/overrides, Bun executable, WolvenKit not marked optional); extends UI-03 | **Fixed** (claude/alpha-polish, 25 Sep) |
| UI-26 | Med | Presentation | `studio-startup.ts` owns settings policy (partial-field merge, queued refresh, revision watch) instead of `LocalSetupActions` | **Fixed** (claude/alpha-polish, 25 Sep): `setup.update` and `requestRefresh()`; the revision watch moved into the preview setup service |
| UI-27 | Med | Accessibility | Card and consent links use yellow `--accent` text: about 1.4:1 contrast in light theme | **Fixed** (claude/alpha-polish, 25 Sep) |
| CORE-04 | Med | Core | Undo at the history limit mislabels entries and creates no-op entries | **Fixed** (claude/cleanup-core, 25 Sep) |
| CORE-05 | Med | Core | Queries deep-copy/reparse the collection (context menu 0.1–0.4 s) and some stash as a side effect | Open |
| CORE-06 | Med | Core | Control edits skip validation and throw raw errors, leaving a transaction open | **Fixed** (claude/cleanup-core, 25 Sep) |
| CORE-07 | Med | Core | Optical-bake and range rules duplicated across core, workers and descriptors | Open |
| CORE-08 | Med | Core | Duplicate action catalogues and Undo policies; finish choices not from the catalogue | Partly fixed (claude/cleanup-core2): Undo policy comes from the descriptor table and the routing sets are compiler-checked against the action unions; the `layer.setFinish` enum is now fed from the finish catalogue (claude/cleanup-pipeline2); new refusals still come back as `invalid_value` (see the Low list) |
| CORE-09 | Med | Core (design) | One layer's glitter model bumps the whole recipe schema; nested schema conditionals | Partly fixed (claude/cleanup-core2): one `requiredRecipeSchema` helper replaces the nested conditionals and never downgrades; the schema is still recipe-wide by design until the feature-module platform |
| CORE-17 | Med | Core | `layer.setFinish` always replaces optics: re-selecting Colour-shift resets shift colour/strength and adds an Undo step; re-selecting Glossy silently upgrades an earlier-model layer; shift settings aren't remembered like Glitter's | **Fixed** (claude/cleanup-core2, 25 Sep) |
| CORE-18 | Med | Core | `layerExport(layerId)` judges layers alone, but Colour-shift eligibility is preset-wide: the Inspector says Experimental while Check omits the layer | **Fixed** (claude/cleanup-core2, 25 Sep) |
| CORE-19 | Med | Core | Same defect as PIPE-23 (Fresnel rule counts unexportable layers) | **Fixed** with PIPE-23 (claude/cleanup-pipeline2, 25 Sep) |
| CORE-20 | Med | Core | Finish/route rules in five places (`finish-export.ts` two tables, `recipe.ts` `GAME_OPTICS_FINISHES`, verifier `resource-checks.ts:61`, `makeup-stack.ts:184-187`); extends CORE-07/UI-10 | **Fixed** (claude/cleanup-pipeline2, 25 Sep) |
| CORE-10 | Med | Core | One damaged recovery draft blocks the whole workspace restore | **Fixed** (claude/cleanup-core, 25 Sep) |
| CORE-11 | Med | Tests | Core test gaps (startup wiring, history limit, workspace size, routing) | Partly fixed (claude/cleanup-core); routing tests remain |

**Low findings** (picked up opportunistically). Paths are relative to `projects/xf-studio/authoring`.

- **PREV-09..16** (preview export, 25 Sep focused review): silent fallback to unhashed prepared files; host precedence drift; non-atomic cache write; no cache eviction or work-folder sweep; duplicate fingerprints; synchronous hashing on the request path; readiness passed via data attributes; test gaps (loader, error mapping, cache reuse).

- **PIPE-15:** a candidate that fails the second result gate stays in `package-candidates/` (`desktop/build.ts:206-212`).
- **PIPE-16:** Fixed (plate inputs hashed at start and end; morph count comes from the plate recipe).
- **PIPE-17:** `reg.exe` output is decoded as UTF-8, and process output is decoded per chunk (multi-byte splits).
- **PIPE-18:** error codes are mapped by matching message prefixes; needs a typed `PackageFilterError`.
- **PIPE-19:** stale comments in `mod-branding.ts` and `eye-plate-cache.ts` (the publish race comment).
- **PIPE-20:** plate derivation parses large JSON on the host event loop; move it to a worker.
- **PIPE-21:** selector indices shift when presets are omitted; save behaviour unproven. Add to the in-game test card.
- **PIPE-22:** the game-folder ArchiveXL bundle is listed non-recursively and outside source discovery.
- **UI-13:** Fixed in alpha readiness (plain library chip and autosave wording).
- **UI-14:** the command palette recomputes every command's availability per keystroke.
- **UI-15:** theme and lighting actions ignore failures and bypass `rt.dispatch`.
- **UI-16:** Fixed in alpha readiness (CSP, navigation guard, 415, identifiers renamed).
- **UI-17:** `desktop/update-electrobun.ts` is dead and unchecked; two TypeScript versions (5.9.3 vs 7.0.2).
- **UI-18:** `about.css` and boot-watchdog styles aren't tokenised; duplicate font-size tokens; palette input has `outline:none`.
- **CORE-12:** a fresh workspace opens the oldest collection and adds an "Unsaved preset".
- **CORE-13:** dead history helpers; glitter measurements never pruned and keyed by layer IDs that repeat across presets; wrong import consequence text.
- **CORE-14:** confusing names (`selectedCollection` returns a preset ID); `ReadonlyDeep` defined three times; shared mutable `glitterChoices`; stale test counts in the boundary doc.
- **CORE-15:** preview reports ready for one frame after an edit; geometry cache recopies on double updates; reason codes come from matching message text.
- **UI-19:** Fixed in claude/alpha-polish (the category is a plain label while Eye makeup is the only one).
- **UI-20:** Fixed in claude/alpha-polish (see below).
- **PIPE-26:** Fixed in claude/cleanup-pipeline2 (plain `plate_source_incomplete` stop).
- **PIPE-27:** Fixed in claude/cleanup-pipeline2 (typed `eyePlateHead` setting in Game & tools).
- **PIPE-07/PIPE-17 (extended):** the verifier's WolvenKit calls and the desktop Bun probe were moved onto the shared runners in claude/cleanup-pipeline2; `dotnet-runtime.ts` still adds another UTF-8-decoded `reg.exe` reader duplicating `install-detection-host.ts`.
- **PREV-17:** the WolvenKit post-install probe ignores the cancel signal (`wolvenkit-setup-host.ts:314`); Cancel does nothing for up to 30 s.
- **PREV-18:** WolvenKit unpacking runs synchronously on the server, and the .NET registry check re-runs every 3 s while the card polls every 500 ms.
- **PREV-19:** test gaps: `tool-download.ts` stall/redirect/length/oversize paths, `createInstalledHeadSource` end to end (its completeness gate is now unit-tested) and `process-tree`. The PIPE-23 and PIPE-24 cases are covered.
- **CORE-21:** Fixed (claude/cleanup-core2): shift edits are labelled "Shift colour" or "Shift strength".
- **CORE-22:** Fixed in claude/cleanup-pipeline2 (dead eligibility exports removed).
- **CORE-23:** Fixed (claude/cleanup-core2): one `historyTimeline()` mapper in `authoring-history.ts` serves both.
- **CORE-24:** Fixed (claude/cleanup-core2): the first collection keeps every editor-memory field except the recipe.
- **CORE-08/CORE-15 (extended):** new actions were added to both the descriptor table and the hand-kept `recipeKinds`/`undoPolicy()` sets (fixed in claude/cleanup-core2, see CORE-08); new refusals come back as `invalid_value` instead of `incompatible_mode` (open).
- **UI-20 (extended):** Fixed in claude/alpha-polish.
- **UI-28, UI-29, UI-30, UI-31, UI-32:** Fixed in claude/alpha-polish (see below).
- **UI-33:** Partly fixed in claude/alpha-polish: one `PolledHostState` serves both polling ports. Open: `uv-editor` calls `getComputedStyle` on every draw.
- **UI-04/UI-10/UI-11/UI-12 (extended):** `bootstrap.js` grew (Start fresh); Satin alias and glitter ID mapping remain in the UI and the shift slider hard-codes 0–1; `scene.ts` 925 lines, renders every frame, allocates per frame; no behavioural tests for the preview card or startup failure paths.
- **PREV-21, PREV-22, PREV-23, PREV-24, UI-34, UI-35, REL-01:** Fixed in claude/release-prep (see below).
- **PREV-25:** Partly fixed in claude/release-prep: startup head wiring, out-of-order and shared replies, dispose, start gating, failed-head reset and show requests are tested. Open: tests of the rendered card and consent dialog (the suite has no DOM).

## New subsystems since last review

None. (The 3D preview setup service was reviewed at `ecb4b33`.)

## Fixed in claude/release-prep

- **PREV-20:** the head and everything wired to it are one object, `attachBrowserHead` (`src/browser-head-attachment.ts`), which registers a release for each connection as it is made (stage theme binding, application attachments, autosave and status subscriptions, the preview device's scene connection, the surface editor, the camera listener) and releases them newest first on any failure or on `dispose()`. The viewport device owns the scene's lifetime (`loadHead` releases an earlier head, `unloadHead` detaches the surface editor and disposes the scene), and `createScene` releases its renderer, canvas, stage and resize observer if anything fails after the renderer exists; the scene gained `dispose()`. `studio-startup.ts` keeps one `AttachedHead` and releases it before a retry. Tests: `tests/browser-head-attachment.test.ts` (a step failing after the scene loaded, then Try again attaching exactly once; a failed load; reloading over a loaded head).
- **PREV-21:** `PolledHostState` numbers requests and applies a reply or failure only if nothing newer was applied; overlapping refreshes share one in-flight request while nothing newer was sent.
- **PREV-22:** a `disposed` flag stops late replies from applying, publishing or scheduling.
- **PREV-23:** game detection and automatic preparation (including the WolvenKit-ready restart) wait for `start()`.
- **PREV-24:** a failed head returns to waiting once the host leaves `ready`, and loads when it is ready again.
- **UI-34:** the setup service counts show requests (`showRequests`); the card takes focus only when that count changes, never when it opens by itself.
- **UI-35:** the head pane's next-step button applies the setup action's capability (disabled with its reason while a step runs).
- **REL-01:** `desktop/package-content-scan.ts` scans every packaged text member of the real archive in `verify-canary.ts` for absolute user-profile paths (`C:\Users\<name>` in any drive, slash direction or escaping) and email addresses, allowing placeholders, example domains and addresses in licence text, and redacts findings for the public log. Tested in `desktop/tests/package-content-scan.test.ts`; the three canary archives built locally on 25 September scan clean and a planted path is caught.
- **CI (release blocker):** the first Desktop release run failed on a 5.1 s exhaustive flake test under Bun's 5 s default. Tests taking about a second or more locally now carry explicit, commented timeouts (flake-field, glint oracle, mod-verifier resource failures, workspace storage budget, desktop Build deadline).

## Fixed in claude/wolvenkit-fetch

- **PREV-01:** `game-asset-export.ts` publishes an entry only when every output for its kind exists (mesh: raw, GLB, materials; morph target: raw, GLB); a partial export is returned uncached and the next request reruns WolvenKit. Regression test on one shared export cache in `tests/preview-core.test.ts`.
- **PREV-02:** export cache keys include the WolvenKit identity (PE version plus launcher/entry-DLL hash); the preview key covers the exported GLBs (head, eye, eye morph) and material exports and the tool key; manifest and render record name the tool (deriver version 3).
- **PREV-04:** `ensurePreviewCore` routes failures by type: `GameAssetExportError` codes (tool missing, runtime missing, tool failed, cancelled), storage errno codes to `preview_cache_unavailable` with plain disk/permission wording, anything else to `preview_failed`, never blaming WolvenKit.
- **PREV-05:** a resource is reported missing (and blocks until the game changes) only when the game's own RDAR archive index lacks it (`rdar-index-fs.ts`); a tool that exported nothing, or an unreadable index, is a retryable `preview_tool_failed`.
- **PREV-06:** `wolvenkit-cli.ts` owns the process, the success policy (exit code, timeout, cancellation, `Unhandled exception`, per-command accept/failure rules), missing-.NET detection, identity and the sync/async version probe; `eye-plate-wolvenkit.ts`, `game-asset-export-wolvenkit.ts` and `package-build-wolvenkit.ts` map its typed errors to their own codes. The boundary test requires every adapter to go through it.

## Fixed in claude/cleanup-core

- **CORE-01:** save status is published only on change, autosave watches content sources (`session.watch(bootstrap.collection)`) instead of the whole presentation port, and identical content is never rewritten. Test: `tests/workspace-persistence.test.ts` (fake timers, zero idle writes, resumes on edit).
- **CORE-02:** `workspace-budget.ts` bounds the stored workspace (2,000,000 code units per key; selected preset stored once with full Undo, others 5 entries, removed and recovery entries without histories, progressive trimming) and publishes `nearly-full`/`full`. A worst-case realistic workspace (6 eight-layer presets, 80 Undo entries each, 20 removed presets and 4 recovery drafts all with histories, 123M code units verbatim) stores in 1.81M at the standard level. Desktop follow-up: the storage shim should save the host file independently of `localStorage` quota errors, and may pass a larger budget.
- **CORE-10:** damaged recovery drafts and removed presets are dropped with a warning (`repaired` status); only the current draft must parse.
- **CORE-04:** checkpoints return the entry they added; transactions label and discard that entry, and the displaced oldest entry returns when an entry is discarded or undone. Test: `tests/history-limit.test.ts`.
- **CORE-06:** `capability()` applies descriptor payload ranges, `controlEdit` runs the same gate and returns a typed result, exceptions are classified by source, and control dispatch is wired inside `createTrustedAuthoringCore`. Test: `tests/control-edit-validation.test.ts`.
- **CORE-11 (partial):** the tests above, plus touched fixtures (`studio-application`, `alpha-capability-reasons`, `application-boundary-fixture`) now build through `createTrustedAuthoringCore`.

## Fixed in claude/alpha-polish

Paths are relative to `projects/xf-studio/authoring`.

- **UI-21:** a DOM-free `PreviewSetupActions` service (`src/preview-setup.ts`) owns the 3D preview first run: it follows the preparation and WolvenKit ports, finds the game folder, starts preparing by itself on first contact, loads the head, and maps every state to plain wording with one next step. The presentation reaches it only through `StudioPresentationPort.previewSetup` (detached snapshot of the card, the WolvenKit consent and the head pane; 16 typed `previewSetup.*` actions catalogued in `PREVIEW_SETUP_DESCRIPTORS`). The card and consent moved under `studio-ui` (`src/studio-ui/preview-setup-card.ts`) on design tokens; `src/browser-preview-card.ts` is gone, so no boundary exception was needed. "Not now" hides the card and the head pane offers the next step ("Set up 3D preview", "Show progress", "Try again"), which opens it again with focus on its heading.
- **UI-22:** the renderer and preview-record loader throw a typed `HeadLoadError` (`src/head-load-error.ts`: `webgl_unavailable`, `preview_damaged`, `preview_unreachable`, `head_load_failed`). A failure is no longer latched: the head pane shows plain wording (graphics driver or Remote Desktop for WebGL; "Prepare again" for a damaged preview, which asks the host's new `rebuild` action to set the ready entry aside and prepare afresh; "Try again" otherwise, then "Prepare again" after a second untyped failure). A partly loaded scene is released before a retry. Loader text is never shown.
- **UI-23 / UI-33 (polling):** `PolledHostState` (`src/host-state-poller.ts`) is the one polled host-state port behind both `PreviewPreparationActions` and `WolvenKitSetupActions`. A failed poll while the last known state was working re-arms with exponential backoff (capped at 8 s) and publishes `connection()` (failures, retrying); the card says "XF Studio lost contact with its 3D preview service. Still trying (attempt N)…" until the first valid reply clears it. Checked by stopping and restarting the localhost server mid-prepare.
- **UI-24:** `ViewportPhase` gains `preparing` and `unavailable` (`setPending`), with `message` and `progress`. The head pane uses progress styling for checking, loading and preparing, a neutral head icon while something is still needed, and the danger icon only for failures; `data-tone` is set on every paint.
- **UI-25:** Game & tools drops the revision and server-override line, the Bun field and "checked separately"; WolvenKit is "Your own WolvenKit (optional)" with "Leave this empty and XF Studio can download WolvenKit for you"; readiness reads "Ready to build your mod files". The desktop Build setup has the same WolvenKit field and hint and no Bun field. `bunExecutable` is retired from the settings (dropped on load like `pythonExecutable`); desktop Build always runs its own Bun, and `XFS_PACKAGE_BUN` is the localhost developer override. `USER_FACING_JARGON` now also matches settings revisions, server overrides, Bun and "checked separately", and a test scans `studio-ui` and the desktop bootstrap for the retired phrases. The "Head used for the eye plate" dropdown was checked in both themes: plain label, default "The head your game loads (recommended)".
- **UI-26:** `LocalSetupActions` gained `setup.update` (waits for any request in flight, loads if needed, saves only the named fields over the saved ones) and `requestRefresh()` (a refresh asked for while busy runs once the request finishes). `studio-startup.ts` no longer merges fields, queues refreshes or watches the revision; Game & tools saves through `setup.update` too.
- **UI-27:** card and consent links use `--accent-text` (`.link-button`); the card's inline stylesheet is replaced by token-based `studio.css` rules (`.setup-card`, `.consent-sheet`), documented as style-guide pattern `c-setup`.
- **UI-20:** `ViewportInputHints` keeps its own `interactive` state from `viewport.snapshot()[scope].phase`; the strip, tooltip and cursor show only while the viewport is ready, so the input subscription can no longer bring the strip back over the head pane's message.
- **UI-19:** the header category is a plain label (no menu, no informational section) while Eye makeup is the only category; the style guide's `s-category` pattern says it becomes a switcher only when a second approved category exists.
- **UI-28:** localhost opens official pages with `window.open(url, "_blank")` and cuts `opener` on the returned window, so a successful open no longer reports an error; a blocked pop-up says how to allow it.
- **UI-29:** "I already have WolvenKit" (and every "set it in Game & tools" step) dispatches `previewSetup.openSetup`; without a host setup form the Studio reveals the Mod package panel, opens Game & tools and focuses the first empty field.
- **UI-30:** the automatic-start choice is the workspace field `previewSetup.autostart` (verification-scoped with the workspace, kept in the desktop's host-owned file); the earlier page-storage value is read once as a fallback outside verification.
- **UI-31:** the site's finish grid tags Shimmer, Glossy and Colour-shifting "Experimental export" (Glitter stays "Preview study"); the "from source" callout says the preview is built from the developer's own game on first run.
- **UI-32:** the autosave tooltip no longer says "Browser"; a missing bundled WebView2 installer has its own message that doesn't blame the internet (`WEBVIEW2_INSTALLER_MISSING`); the package error's time is when it happened (`files.last.at`); the consent opens on its heading, and Esc is "Not now".
- **UI-12 (partial):** `tests/preview-setup.test.ts` (first run, Not now and re-open, lost poll with backoff and recovery, head-load failure and retry, damaged preview and Prepare again, detected folder merge, consent, catalogue and wording), `tests/local-setup-actions.test.ts`, and additions to the preparation, viewport-device, workspace and WebView2 tests.

## Fixed in claude/cleanup-core2

- **CORE-16 (and CORE-09, partly):** `requiredRecipeSchema()` (`recipe-schema.ts`) computes the schema from every layer's stored form (irregular 7, Direct 8, Clustered 9, Fine 10, game-matched optics 11) and never goes below the current schema. `applyRecipeAction` applies it to every edit and `selectGlitterModel` uses it, so no per-layer choice downgrades the recipe or invalidates another layer. Tests (`tests/finish-actions.test.ts`): Glitter models beside game-matched Glossy, Direct beside Fine on recipe-11 and recipe-10, no downgrade after removing or changing the last game-matched layer, and every finish/model the capability offers also dispatches.
- **CORE-17:** re-selecting the current finish (Satin and its alias included) is a no-op with no Undo step, so an earlier-model Glossy layer stays as it is until `layer.useGameOptics`. Colour-shift settings are remembered per preset and layer in the same editor memory as inactive Glitter models (the workspace's `glitterChoices` key gains an optional `shift` entry that older builds ignore); leaving Glitter also keeps the active model's settings.
- **CORE-18:** `StudioApplication.layerExport()` returns the layer's status in the preset-level plan (`planPresetExport`), with `blockedBy: "layer" | "preset"`; a hidden layer is judged as if shown. The Inspector shows "Left out of this preset" with the plan's reason instead of "Experimental" or "Earlier preview model".
- **CORE-08 (partial):** `undoPolicy()` reads the descriptor table (command or key variant first); the recipe and collection routing sets are typed records over the action unions (`RECIPE_ACTION_KINDS`), and the selection-only set is derived from descriptor `effect`. One visible change: the Presets "Restore" entry now reports the descriptor's `recovery` policy. Boundary test in `tests/studio-application.test.ts`.
- **CORE-21, CORE-23, CORE-24:** see the Low list.

## Fixed in claude/cleanup-pipeline2

- **PIPE-23 / CORE-19:** `planPresetExport` leaves out layers no route can carry first, then applies the colour-shift one-pigment rule to the exportable layers; a Colour-shifting layer beside Glitter exports on the Fresnel route with only the Glitter layer reported, and per-layer exclusion reasons (CORE-18) are kept. Tests in `tests/finish-export.test.ts`.
- **CORE-20 / CORE-22 / CORE-08 (finish choices):** `FINISH_EXPORT` in `finish-export.ts` is the one per-finish table (game-matched model, route, experimental flag, flat surface, Check note, catalogue summary, refusal). `layerExport`, `finishExportSummary`, `flatSurface`, `hasGameOptics` (recipe validation and `recipe-actions.ts`) and the preview's surface values (`makeup-stack.ts`) derive from it; `SUPPORTED_FLAT_FINISHES`, `unsupportedFlatLayers`, `presetRoute`, `FLAT_SURFACE` and `GAME_OPTICS_FINISHES` are gone. `layer.setFinish` accepts `FINISH_IDS` from `finish-catalogue.ts` plus the hidden legacy alias `satin`, and the Finish menu offers only catalogue entries. The verifier keeps its own restated table (`VERIFIER_FINISHES`); `tests/mod-verifier-routes.test.ts` fails if the two disagree.
- **PIPE-24:** the verifier re-derives each preset's route from its recipe (any colour shift means Fresnel with one pigment and nothing else, otherwise any Shimmer means faceted, otherwise flat; no route for Glitter or earlier models) and requires the plan's route and material entry and the compiled record to match; a missing route fails. It compares every recipe with the packaged collection the service passes, reports `presetRoutes`, and the service requires them to equal Check's. Check, the manifest's `presets` entries and the host result gate carry each preset's `route`. Tamper tests alter `plan.route`, remove it, alter the compiled record and the recipe, and build a consistent Shimmer-as-flat package; on a copy of the real finish-board build, changing one route in `build.json` failed verification.
- **PIPE-07 (verifier) and the desktop spawn helper:** `runWolvenKitSync` gives synchronous callers the shared success policy and typed errors; `src/verifier-wolvenkit.ts` injects the verifier's unbundle, serialize and export through it (the verifier directory still imports nothing), with the shared `WOLVENKIT_RUNTIME_MISSING_MESSAGE`. The desktop Bun probe uses `runProcessTree`, which stops the whole tree.
- **PIPE-26:** `incompleteHeadSource` stops Build with `plate_source_incomplete` and one next step when a scan gap may hide an archive or `.xl` file (source discovery now marks a skipped link to a plain file as harmless) or when an unreadable archive index ranks before the head's winning archive (or a head resource or plate-relevant patch source was found nowhere). The reference MO2 route's four linked non-mod files in `overwrite` do not block.
- **PIPE-27:** the typed Local setup field `eyePlateHead` (`installed` or `base-game`, default `installed`) is saved through the shared `LocalSetupActions` and shown as "Head used for the eye plate" under Game & tools; the setup view supplies its label and options, so the form and Build's message name it the same way. Both hosts pass it to the plate service; `XFS_EYE_PLATE_HEAD` remains a developer override. The desktop bootstrap's own setup fields do not show it (saving there keeps the stored value).
- **PIPE-25 (partial):** a published plate is reused without extraction, serialization or hashing when the chosen archives' path, size, time and entry paths, the patches, recipe and head choice match (`head-inputs/` records in the plate cache); mod archive hashes are memoised by path, size and time. Remaining: route resolution (discovery, index caches, `.xl` parsing, about 2 s on the reference route) still runs synchronously on the host each Build; moving it and plate derivation (PIPE-20) into a worker or the builder process is the next step.
- **PREV-03 (comment):** `preview-core-recipe.ts` now says the preview reads the base game's head while Build uses the launch route's head.

## Fixed in claude/cleanup-pipeline

- **PIPE-13:** a new Authoring workflow runs `bun test`, `bun run check` and `bun run build` on Ubuntu and the desktop typecheck (Electrobun devkit) and `bun test tests` on Windows for pushes to `main` and pull requests touching the authoring source. `XFS_REQUIRE_ORACLES=1` turns oracle, game-integration and declared private-asset skips into failures for release runs.
- **PIPE-02, PIPE-16:** the independent verifier unbundles its own copy of the archive, checks every member hash, then runs its own WolvenKit serialize and texture export on those members and the plate inputs; it parses the `.archive.xl` structurally, re-hashes plate inputs at the end, and takes the morph target count from the plate recipe. The builder no longer writes the round trip or texture export.
- **PIPE-01:** the built-in plate is cut from the head the launch route loads (generic resolver plus `.xl` patches), with topology gates, provenance in the plate and package manifests, a cache key over that provenance, a named `plate_source_modded` stop and the `XFS_EYE_PLATE_HEAD=base-game` escape hatch.

## Fixed in claude/retire-legacy

- **UI-05:** one composition root, `src/studio-startup.ts`, started by the localhost entry `studio-main.ts` and by the desktop bootstrap (which now bundles `studio-startup.js` instead of `studio-main.js`). The sidebar shell (`main.ts`, `/legacy.html`, `style.css`, eleven `*-ui.ts` modules), `/port-smoke.html` and `/application-boundary-fixture.html` were removed; `tests/trusted-studio-bootstrap.test.ts`, `tests/studio-presentation.test.ts` and `tests/studio-application.test.ts` remain the page-free port fixtures. Legacy-only `preset.expand`/`collection.filesOpen`, the workspace `panels` block, draft `expanded`/`filesOpen` flags, `captureBrowserPanels`, `setupContextMenus` and the editors' keyword-cursor fallback went with it; stored workspaces with those fields still restore (fields ignored).
- **UI-06 (data attributes):** host differences reach the root as a typed `StudioHost` (storage, budget, preparation service, shared `LocalSetupActions`, setup place, flush and preview-ready callbacks); `tests/studio-ui-boundary.test.ts` fails if the root or entry reads `dataset`, `xfDesktop*` or `xfs-desktop*`. The desktop smoke report uses the ready callback, and the WolvenKit card's `xfs-host-setup-changed` window event became the card's `onSetupChanged` callback into the root. The WolvenKit consent and .NET card now run on both hosts through the shared `src/browser-preview-card.ts`; one `LocalSetupActions` instance is shared by Build setup, Game & tools and the card, and `idle()` lets a save wait for another view's refresh instead of being refused as busy. Boot and head-load failures show plain sentences; raw error text remains only after "The 3D preview couldn't be loaded:" for loader messages, which are already plain.
- **PREV-09 and the prepared-file path:** the core head, plate, eyes and maps come only from the derived game-file preview on both hosts. Removed: localhost prepared-file precedence and `XFS_PREVIEW_CORE=derived`, the desktop five-file intake (`desktop/asset-intake.ts`, marker, dialog, endpoint, trial scripts, `review-ready-assets.ts`), `tools/export_preview.py`, the unhashed prepared render record and the prepared-eyes notice. Render records must be `game-files` with hashes and morph sources. The preparation card (`src/browser-preview-card.ts`) is shared, so localhost with no cache offers preparation from the saved settings. Real-geometry tests read the derived head and skip with a reason when no preview is prepared.
