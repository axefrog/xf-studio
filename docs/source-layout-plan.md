# Studio source layout plan

This is the plan for giving `projects/xf-studio/authoring/src/` a layout a newcomer can read: about 343 flat top-level modules move into subsystem folders, and the import boundary test enforces the layering by folder instead of by name lists. It is a pure reorganisation: no behaviour changes, no module is renamed, split or merged. The machine-readable map is [source-layout-plan.json](source-layout-plan.json): `{ "src/<old>.ts": "src/<new>.ts" }`, relative to `projects/xf-studio/authoring/`. It covers every flat `.ts` module, the two `.json` files beside them, and ten optional moves inside `diagnostics/` and `showroom/` (see [Mixed concerns](#mixed-concerns)).

## Principles

- **Subsystem first, then kind.** A top-level folder is a subsystem. Inside it, the subsystem's pure and application code sits at the root, and three kind folders hold what is not portable. This is the convention `features/<id>/` already uses (`view/`, `render/`, `export/`, `verify/`, `host/`):
  - `host/`: Bun-only code (files, processes, the OS, SQLite, endpoints);
  - `browser/`: page devices (DOM, `fetch`, workers, canvas);
  - `render/`: Three renderer modules (materials, loaders, motion, lights).
- **Basenames stay.** Every module keeps its file name, so worker and page bundles keep their `/build/<name>.js` names, the basename rules in the boundary test (`-actions`, `-service`, `-host`, `-server`) keep working, and the Hair Lab port stays mechanical. Redundant prefixes (`cc-`, `character-`, `browser-`) can be dropped later as a separate decision.
- **Existing folders keep their contracts.** `platform/`, `engines/`, `features/`, `compose/`, `studio-ui/` and `native/` keep their rules. Eye makeup's modules that the shell still reaches can't move into `features/eye-makeup/` yet (CORE-29), so they get one clearly named staging folder.

## Target tree

New code follows the same rule as today: a feature's code goes in its feature folder or an engine. The folders below hold the shell and the shared subsystems.

```
src/
  compose/                composition lists and the browser roots (studio-main, studio-startup); only roots import it
  platform/               unchanged: api (+ read-only, validation-issues, request-body), core, scene, export, persistence
  engines/                unchanged: shared pure engines (layered-makeup, facial-rig, red-object, save)
  features/               unchanged: feature modules
  studio-ui/              unchanged: the presentation shell (+ context-menu, which is presentation policy)

  app/                    the Studio shell's application services behind the presentation port: the application, the port,
                          action descriptors and consequences, file operations, the trusted bootstrap, UI preferences and
                          layouts, input bindings, viewport attachment
  app/authoring/          the live authoring document: edits, gestures, control runs, geometry projection
  app/workspace/          the page's workspace draft: codec, collection drafts, size budget, persistence, composer
  app/browser/            the shell's page devices: files, workspace storage, the document store transport

  library/                collections, looks and part presets: services, sessions, actions, preset sets
  library/host/           the library file: stores, migrations and the per-host composition (library-files)
  library/browser/        the collection transport

  eye-makeup/             eye makeup's modules outside its feature module, still reached by the shell (CORE-29): its model,
                          descriptors, Undo labels, history part, authoring port, recipe lineage, mod branding, UV view
  eye-makeup/preview/     the layered preview's policy: coordinator, tiers, quality, render queue
  eye-makeup/browser/     its preview and editor devices: raster client and worker, UV and on-head editors
  eye-makeup/export/      the package pipeline's pure part: plan views, partial-export filter, resource definitions, Glitter routes
  eye-makeup/export/host/ the package pipeline's host part: bake, resource builder, WolvenKit and native tools, inventories
  eye-makeup/plate/       the expanded eye plate's pure part: recipe (+ JSON), byte cut, verifier, head-source policy
  eye-makeup/plate/host/  the plate's host part: cache, service, WolvenKit adapter, head resolver, Build prerequisite

  game/                   reading the game the way the game does: depot paths, archive precedence, ArchiveXL, the resource
                          graph, WolvenKit JSON, RDAR indexes, TweakDB, TweakXL, game text, material and layer readers
  game/host/              the installation as the host opens it: source discovery, installation registry and snapshot,
                          route fingerprint, resolver host, game asset export (WolvenKit and native)

  character/              the shown V: creator catalogue and panel projection, presets, character context, detail request
                          and plan, character resolver, clothing, choice previews, render records, face morphs
  character/host/         the character's host services and endpoints: catalogue, icons, swatches, detail preparation,
                          choice previews and manifests, clothing, prepared answers, mod makers
  character/browser/      the character's page devices: catalogue, details, choice previews (worker and its renderer),
                          reference textures, warm start
  character/render/       the character's renderer modules: detail loaders, skin placement, scene evidence

  materials/              the game's material templates as data: which templates the renderer draws, the hair colour model
  materials/render/       the Three material adapters: skin, eyes, layered, decals, brows, hair, metal, glass, mouth

  animation/              V's motion as data: facial catalogue and preview, expression samples, idles, poses, blink words,
                          dangle (hair physics), deformation rig, mouth aperture, motion actions
  animation/host/         facial, idle and pose host services and endpoints, dangle and rig readers, the expressions prerequisite
  animation/browser/      the facial and pose devices
  animation/render/       the idle, blink, dangle and pose motion on the rig

  preview/                the 3D preview: preview actions and view graph, preview setup and preparation, camera, stage,
                          creator and studio lighting, lighting setups, grading LUT, the preview core recipe and assembly
  preview/host/           the preview core and grading LUT host services and endpoints
  preview/browser/        the head attachment, viewport device, scene ports and stage theme binding
  preview/render/         the stage: lighting stage and rig, shadows, display path, environment, backdrop, camera input,
                          render scheduler, pixel ratio, grading LUT device

  saves/                  the player's saves: the saved V, its loadout and package
  saves/host/             where the Save Explorer's host endpoints read from
  saves/browser/          the Save Explorer's device

  installation/           the player's installation as XF Studio finds and adds to it: install detection, MO2, Vortex,
                          framework versions, mod install actions
  installation/host/      detection and Vortex readers, the mod install host and transport, runtime diagnostic stage
  installation/browser/   the install detection and mod install devices

  setup/                  XF Studio's own setup: local settings, readiness codes, WolvenKit setup, update check, desktop app
  setup/host/             the settings store and endpoint, readiness, WolvenKit download and .NET check, ZIP reader,
                          update check host and releases adapter, desktop-app host, host state
  setup/browser/          the page's setup, update-check and desktop-app devices and their shared host request

  host/                   shared host infrastructure: derived cache, prepared files, host jobs and event loop, code identity,
                          the process runner, the one WolvenKit runner, the localhost package route
  formats/                generic file formats with no game knowledge: GLB, PNG, Base64, LevelDB, PE version
  native/                 unchanged: XF Studio's own game-format reader and writer
  diagnostics/            unchanged rules; optionally split into diagnostics/host/ and diagnostics/browser/
  showroom/               unchanged; optionally build and verify into showroom/host/
  studies/                research-only pages and fixtures (render fidelity study, eye and brow study fixtures, native eye intake)
```

The tree has 22 top-level folders instead of 8 plus 343 files. The largest folders are `character/` (31 modules) and `app/` (21). Every other folder holds between 1 and 19 modules.

## Boundary rules the tree enables

These rules are written as they would be encoded in `tests/architecture-import-boundary.test.ts`. "Host folder" means any `host/` folder at any depth, `platform/export/`, `platform/persistence/`, `features/*/{export,verify,host}/`, `native/` and the host composition `compose/exporters`. Each rule runs over a source tree, so it is also shown to fail on injected probes, as the current rules are.

1. **Host access only in host folders.** Only host-folder modules import `node:fs`, `node:fs/promises`, `node:child_process`, `node:os`, `node:async_hooks`, `node:url`, `node:worker_threads` or `bun:*`, or call `Bun.spawn`, `Bun.file`, `Bun.write` or `Bun.serve`. Pure helpers may still use `node:crypto`, `node:path` and `node:zlib`; rule 3 keeps them out of the page.
2. **Pure and browser code never imports host code.** No module outside a host folder imports a host-folder module by value. Type-only imports are allowed, as the feature-view rule allows them. Nine such contracts exist today (see [Mixed concerns](#mixed-concerns)).
3. **The page never loads host code.** The value reach of the browser entries (`compose/studio-main`, `compose/studio-startup`, the raster and choice-preview workers) contains no host-folder module and no `node:` or `bun:` specifier. This replaces today's narrower rule 6, which covered only exporters and verifiers.
4. **Three only where rendering is.** A value import of `three` appears only in `render/` folders, `browser/` folders, `platform/scene/`, engine and feature `render/`, and `studies/`. Pure modules may still name Three by type.
5. **Devices are wired by the roots.** A `browser/` module is imported only by the composition roots and other `browser/` modules.
6. **Renderer modules are for renderers.** A non-engine, non-feature `render/` module is imported only by `render/` and `browser/` folders, `platform/scene/`, engine and feature renderers and `studies/`. One type-only import exists today (`motion-actions` reads `PosePlacement` from `pose-clip`).
7. **Pure modules stay pure.** Modules outside the kind folders, `studio-ui/`, feature views, `compose/` and `studies/` import no `browser/` or `render/` module and no `three` by value, nor `platform/scene`, `compose/` or presentation. This generalises today's trusted-services test from a list of ten modules to all of them.
8. **The scene host by folder** (replaces the scene lists):
   - Direct imports: `platform/scene/**` imports only `platform/**`, `three`, `three/addons/**`, and the root or `render/` modules of `materials/`, `character/`, `animation/`, `preview/` and `saves/`.
   - Reach: everything it reaches, types included, is one of those, a `game/` or `formats/` root module, or `app/input-bindings`. It is never a host or `browser/` folder, `compose/`, `studio-ui/`, `features/`, `engines/` or `platform/{core,export}`, and never a module whose basename ends in `-actions`, `-service`, `-host` or `-server`.
9. **Engine and feature renderers.** A renderer may reach `platform/api`, `engines/` (no other renderer), `three`, `materials/**`, `game/` root modules and four named modules (`character/render-detail`, `preview/grading-lut`, `preview/creator-lighting`, `preview/render/linear-display`). Today's lists name twelve.
10. **Studies are leaves.** Nothing outside `studies/` imports `studies/`.
11. **Unchanged rules, with new paths.** The feature, view, exporter, verifier and host-folder rules, CORE-29 (only `compose/` and the roots reach a feature), the platform rules and the studio-ui rules stay as they are. Their basename patterns become folder patterns: `browser-` becomes `(^|/)browser/`, and `scene$` becomes `platform/scene/`.

Checked against today's imports, mapped to the new paths: rules 1, 3, 4, 5, 7 and 10 have no violations, with the optional `diagnostics/` and `showroom/` moves. Rule 2 has none by value and nine type-only contracts. Rule 6 has one type-only import. Rule 8 holds as stated.

## Legacy allow-lists the move retires

In `tests/architecture-import-boundary.test.ts`:

- **`PURE_HELPERS`** (`read-only`, `validation-issues`, `request-body`) is deleted. The three helpers move into `platform/api/`, which engines, feature cores and feature host folders may already import. This is a decision for the coordinator, because it widens the platform API by three small pure helpers.
- **`SCENE_DEVICE_MODULES`** (45 names) and **`SCENE_SUPPORT_MODULES`** (25 names) are deleted, replaced by rule 8. The structural rule is stricter where it matters: any future module in a host or `browser/` folder is caught without listing it. It is looser in one way: the scene may use a new pure module of those five subsystems without adding it to a list.
- **`SCENE_MATERIALS`** becomes the folder `materials/render/` plus `preview/render/linear-display`. **`SCENE_MATERIAL_SUPPORT`** shrinks to rule 9's three named pure modules plus `game/` roots.
- **`DIAGNOSTICS_PURE`** and **`DIAGNOSTICS_HOST`** are deleted if the optional `diagnostics/` split is taken. The folders then carry the rule: `diagnostics/` pure, `diagnostics/host/` host, `diagnostics/browser/` the device. The test that only roots import the endpoint and device stays.
- **The trusted-services list and its regex** become rule 7, which covers every pure module.
- **The `node:` parts of the per-module tests** (install detection, character resolver, 3D preview derivation, WolvenKit setup, eye plate head source, package resource definitions) are covered by rules 1 and 2. Their ownership assertions stay: one WolvenKit runner that alone starts the process, the resolver and grading-LUT hosts using it, the install-detection actions reaching the host only through their transport, the eye plate's head-source port, and `package-resources` importing only its listed modules.
- **The presentation pattern** loses `context-menu` (which moves into `studio-ui/`) and `[\w-]+-ui`, which matches nothing. The core-versus-presentation test walks the whole tree instead of reading the top of `src/`.
- **Not retired:** `FEATURE_CORE_LEGACY` and `EXPORTER_LEGACY` keep their entries with new paths, because each entry carries its own removal step. All their entries now sit in `eye-makeup/`, which makes the remaining debt visible in the tree.

In `tests/studio-ui-boundary.test.ts`, the `context-menu` entry in `CORE_VALUES` goes, because the module becomes the shell's own. The other keys only change path.

## Mixed concerns

None of these is split in the move. Each proposal is small and can be its own commit after the move.

1. **`mod-branding`** holds XF Eye Artistry's names, plus the showroom's mod name (`FINISH_SHOWROOM_MOD`) and generic presentation wording (`MOD_NAME_HINT`, used by the Expressions view). It moves to `eye-makeup/`, where `FEATURE_CORE_LEGACY` says it belongs. Later, the showroom name moves to `showroom/` and the hint to the presentation.
2. **Contract types defined in host or render modules** (rule 2 and rule 6, type-only):
   - `StoredCollection` and `CollectionSummary` in `library/host/collection-store` (used by collection actions, service, session and transport);
   - `LocalSetupFields` and `LocalSetupView` in `setup/host/local-settings-server` (used by `local-setup-actions` and the Game setup panel);
   - `CollectionPlan` in `eye-makeup/export/host/package-bake` (used by `package-resources`);
   - `FrameworkReference` in `setup/host/dotnet-runtime` (used by `wolvenkit-release`);
   - `PosePlacement` in `animation/render/pose-clip` (used by `motion-actions`).

   Proposal: move each type to the pure module beside it. That is trivial, and it lets rules 2 and 6 count type imports too.
3. **`diagnostics/`** mixes a pure half and a host half in one folder, held apart by two name lists. The JSON map includes the optional split: `diagnostics/host/` gets seven modules and `diagnostics/browser/` gets `browser-device`. Drop those eight lines to keep the folder as is.
4. **`showroom/`** keeps two host-only build and verify modules beside its pure resource list. The map optionally moves them to `showroom/host/`.
5. **`facial-host`** (1,065 lines) is the facial host service and its HTTP handling in one module. Other subsystems split these into `-host` and `-server` modules. This is noted only, because the split is not trivial.
6. **`desktop-app` and `studio-action-descriptors` import each other** (the descriptors list the desktop-app actions; the offer reads its descriptors). Noted.
7. **`workspace-state`** is one codec that spans preview, character, eye makeup and UI preferences. It is the hub of `app/workspace/`; noted, not a split.
8. **`glitter-studio-flakes`** is imported by nothing in `src/`; only a test and experiment 021 use it. It moves with the export pipeline's pure part, and it is flagged as possibly dead.

## Risks and how phase 2 handles them

- **Dynamic imports.** The boundary test already proves that no module has a computed `import()` or `require()`. Template-literal and `new URL("./x.ts", import.meta.url)` specifiers are rewritten like static ones.
- **Workers and bundle names.** The page loads `/build/raster-worker.js` and `/build/choice-preview-worker.js` by string, and public pages load `/build/<entry>.js`. Basenames are kept, so the names don't change.
  - `browser-build.ts` builds with `naming: "[name].[ext]"`, so only its entry list changes.
  - **`desktop/prepare-static.ts` builds its three browser entries from a list of bare file names under `src/`, with no `naming` option.** Once the entries sit in different folders, Bun would write `build/compose/studio-startup.js` and similar paths, and the desktop page would get 404s. Phase 2 edits the list and adds `naming: "[name].[ext]"`, then checks the output names of the desktop prepare-static build.
- **Two modules locate themselves on disk; both are hand edits, not import rewrites.**
  - `host-code-identity` hashes its own source folder (`dirname(import.meta.url)`). In `host/` it would hash only `src/host/`, so warm-restart answers could be reused after a code change elsewhere. It must keep hashing all of `src/`.
  - The localhost `package-server` finds the app as `resolve(import.meta.dir, "..")`; under `host/` that becomes `"../.."`.

  The moves change the code identity once, so the first start after the move prepares warm-restart answers again (expected, one-off).
- **Relative JSON imports.** `eye-plate-recipe` moves with its two JSON files. `private-data` reaches `tools/private-data.json` and `expression-samples` reaches `data/`. The rewrite resolves these like any other specifier.
- **Tests and tools that name modules by string.** Some tests read sources by bare name, such as `source("studio-application")`, `resolve(…, "src", "x.ts")` or lists of file names. The main ones are the two boundary tests, `render-detail-record`, `cc-controls-boundary`, `detail-limits`, `choice-preview`, `trusted-preview-services`, `studio-registry` and `spec-fields`, about 20 files in all. Bare strings can't be rewritten mechanically, because names like `skin`, `glb` and `png` are also data words. Phase 2 edits them by hand, with the full suite as the gate.
- **Code outside `src/` that imports `src/`.** This covers `tests/`, `tools/`, `desktop/` (including `bootstrap.js`), `server.ts`, `browser-build.ts`, and the repository's `experiments/*/*.ts`, which `bun run check` typechecks through `tsconfig.experiments.json`. The rewrite script covers all of them. Experiment `.py` scripts mention paths only in comments, and the script rewrites those too.
- **Docs.** About 95 Markdown files carry about 570 references to flat `src/*.ts` paths. The script rewrites inline-code paths and relative links, skips `<!-- historical-paths -->` regions (dated records keep naming code as it was), and `check_links.py` is the gate.
  - Three files are off-limits to this branch's agent and need the coordinator's call:
    - `research/authoring/code-health.md` has 47 lines of path references. The script can rewrite the paths there without changing content, or the coordinator does it.
    - `research/authoring/architecture-contract.md` and `docs/status.md` have no `src/*.ts` paths. The contract's "Source layout" section and its references to `studio-startup.ts` and `studio-main.ts` need new text.
  - Bare module names in prose (no `src/` prefix) aren't checked by the link checker and are left as they are.
- **The style guide.** `public/studio.css` and the generated `public/style-guide.html` mention `src/input-bindings.ts` in comments. The guide is regenerated with `tools/build-style-guide.ts`, and the style-guide test checks it. The only change is that path; the UI track should be told.
- **The Hair Lab port.** The script resolves every specifier from the importer's old location and maps both ends, so it fixes imports in files that aren't in the map. A new flat module on the Hair Lab branch gets correct specifiers once it's added to the map with a target folder.
  - Recommended order: Hair Lab merges `main` straight after the move. Edits to moved files follow the renames, because the commits are pure `git mv` plus import-line edits, so similarity stays high. Hair Lab then runs the script in rewrite-only mode over its own new files.
  - Any other open branch that touches flat modules follows the same route. A short merge freeze during the move keeps it to one pass.
- **Collisions.** No two modules map to the same path, and no target already exists (checked).
- **What could still surprise.** Module-name strings in code outside tests, such as diagnostics traces or log origins naming a module, are not import paths and stay unchanged. Phase 2 greps for flat basenames in string literals under `src/` and reports any it finds.
