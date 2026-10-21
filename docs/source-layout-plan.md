# Studio source layout

`projects/xf-studio/authoring/src/` is organised so a newcomer can tell from the tree what each subsystem is and where a change belongs, and the import boundary test enforces the layering by folder. The layout replaced about 343 flat top-level modules. The move was a pure reorganisation: no behaviour changed, and no module was renamed, split or merged; nine contract types moved beside the pure code that reads them.

The map of the move is [source-layout-plan.json](source-layout-plan.json): `{ "src/<old>.ts": "src/<new>.ts" }`, relative to `projects/xf-studio/authoring/`. It covers every former flat module, the eye plate's two recipe files, and the host and device modules of `diagnostics/` and `showroom/`. `tools/source-layout.ts` applies it (see [Moving another branch](#moving-another-branch)).

## Principles

- **Subsystem first, then kind.** A top-level folder is a subsystem. Its pure and application code sits at its root, and three kind folders hold what is not portable. This is the convention `features/<id>/` already used (`view/`, `render/`, `export/`, `verify/`, `host/`):
  - `host/`: Bun-only code (files, processes, the OS, SQLite, endpoints);
  - `browser/`: page devices (DOM, `fetch`, workers, canvas);
  - `render/`: Three renderer modules (materials, loaders, motion, lights).
- **Basenames stay.** Every module kept its file name. Worker and page bundles keep their `/build/<name>.js` names, and the basename rules in the boundary test (`-actions`, `-service`, `-host`, `-server`) still work. Redundant prefixes (`cc-`, `character-`, `browser-`) can be dropped later as a separate decision.
- **Existing folders keep their contracts.** `platform/`, `engines/`, `features/`, `compose/`, `studio-ui/` and `native/` keep their rules. Eye makeup's modules that the shell still reaches can't move into `features/eye-makeup/` yet (CORE-29), so they wait in `legacy/eye-makeup/` ([why](../projects/xf-studio/authoring/src/legacy/README.md)).

## Tree

New code follows the same rule as before: a feature's code goes in its feature folder or an engine. The folders below hold the shell and the shared subsystems.

```
src/
  compose/                composition lists and the browser roots (studio-main, studio-startup); only the composition imports it
  platform/               api (+ read-only, validation-issues, request-body), core, scene, export, persistence
  engines/                shared pure engines (layered-makeup, facial-rig, red-object, save)
  features/               feature modules
  studio-ui/              the presentation shell (+ context-menu, which is presentation policy)

  app/                    the Studio shell's application services behind the presentation port: the application, the port,
                          action descriptors and consequences, file operations, the trusted bootstrap, UI preferences and
                          layouts, input bindings, viewport attachment
  app/authoring/          the live authoring document: edits, gestures, control runs, geometry projection
  app/workspace/          the page's workspace draft: codec, collection drafts, size budget, persistence, composer
  app/browser/            the shell's page devices: files, workspace storage, the document store transport

  library/                collections, looks and part presets: services, sessions, actions, preset sets
  library/host/           the library file: stores, migrations and the per-host composition (library-files)
  library/browser/        the collection transport

  legacy/eye-makeup/      eye makeup's modules outside its feature module, still reached by the shell (CORE-29): its model,
                          descriptors, Undo labels, history part, authoring port, recipe lineage, mod branding, UV view
    preview/              the layered preview's policy: coordinator, tiers, quality, render queue
    browser/              its preview and editor devices: raster client and worker, UV and on-head editors
    export/               the package pipeline's pure part: plan views, partial-export filter, resource definitions, Glitter routes
    export/host/          the package pipeline's host part: bake, resource builder, WolvenKit and native tools, inventories
    plate/                the expanded eye plate's pure part: recipe (+ JSON), byte cut, verifier, head-source policy
    plate/host/           the plate's host part: cache, service, WolvenKit adapter, head resolver, Build prerequisite

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

  setup/                  XF Studio's own setup: local settings and the setup view, readiness codes, WolvenKit setup,
                          update check, desktop app
  setup/host/             the settings store and endpoint, readiness, WolvenKit download and .NET check, ZIP reader,
                          update check host and releases adapter, desktop-app host, host state
  setup/browser/          the page's setup, update-check and desktop-app devices and their shared host request

  host/                   shared host infrastructure: derived cache, prepared files, host jobs and event loop, code identity,
                          the process runner, the one WolvenKit runner, the localhost package route
  formats/                generic file formats with no game knowledge: GLB, PNG, Base64, LevelDB, PE version
  native/                 XF Studio's own game-format reader and writer
  diagnostics/            diagnostics' pure half; diagnostics/host/ its host half; diagnostics/browser/ the page's device
  showroom/               the finish showroom's resources; showroom/host/ its build and verifier
  studies/                research-only pages and fixtures (render fidelity study, eye and brow study fixtures, native eye intake)
```

## Boundary rules

`tests/architecture-import-boundary.test.ts` encodes these. "Host folder" means any `host/` folder at any depth, `platform/export/`, `platform/persistence/`, `features/*/{export,verify}/`, `native/` and the host composition `compose/exporters`. Each rule runs over a source tree, so it is also shown to fail on injected probes.

1. **Host access only in host folders.** Only host-folder modules import `node:fs`, `node:fs/promises`, `node:child_process`, `node:os`, `node:async_hooks`, `node:url`, `node:worker_threads`, `node:net`, `node:http(s)` or `bun`/`bun:*`, call `Bun.spawn`, `Bun.file`, `Bun.write` or `Bun.serve`, or read `process.env` or `Bun.env`. Pure helpers may still use `node:crypto`, `node:path` and `node:zlib`; rule 3 keeps them out of the page.
2. **Pure and browser code never imports host code,** not even a type.
3. **The page never loads host code.** The value reach of the browser entries (`compose/studio-main`, `compose/studio-startup`, the raster and choice-preview workers, the render fidelity study) contains no host-folder module and no `node:` or `bun:` specifier.
4. **Three only where rendering is.** A value import of `three` appears only in `render/` folders, `browser/` folders, `platform/scene/` and `studies/`. Pure modules may name Three by type.
5. **Devices are wired by the composition.** A `browser/` module is imported only by `compose/`, other `browser/` modules and `studies/`.
6. **Renderer modules are for renderers.** A non-engine, non-feature `render/` module is imported only by `render/` and `browser/` folders, `platform/scene/`, `compose/` and `studies/`.
7. **Pure modules stay pure.** Modules outside the kind folders, the presentation, `compose/`, `platform/scene/` and `studies/` import no scene host, composition or presentation module (rules 2, 5 and 6 already keep host code, devices and renderers out).
8. **The scene host by folder.** `platform/scene/**` imports only `platform/api`, its own folder, `three`, `three/addons/**`, and the root or `render/` modules of `materials/`, `character/`, `animation/`, `preview/` and `saves/`. Everything it reaches, types included, is one of those, a `game/` or `formats/` root module, or `app/input-bindings`. It is never a host or `browser/` folder, `compose/`, `studio-ui/`, `features/`, `engines/` or `platform/{core,export,persistence}`, and never a module whose basename ends in `-actions`, `-service`, `-host` or `-server`.
9. **Engine and feature renderers** may reach `platform/api`, `engines/`, `three`, `materials/**`, `preview/render/linear-display`, `game/` root modules and three named pure modules (`character/render-detail`, `preview/grading-lut`, `preview/creator-lighting`).
10. **Studies are leaves.** Nothing outside `studies/` imports `studies/`.

The feature, view, exporter, verifier and host-folder rules, CORE-29 (only `compose/` reaches a feature), the platform rules and the studio-ui rules are unchanged apart from their paths; their basename patterns became folder patterns.

**Lists the layout retired.** `PURE_HELPERS` (the helpers are part of `platform/api`); `SCENE_DEVICE_MODULES` and `SCENE_SUPPORT_MODULES` (rule 8); `SCENE_MATERIALS` (the `materials/render/` folder); `DIAGNOSTICS_PURE` and `DIAGNOSTICS_HOST` (the diagnostics folders); the trusted-services import regex (rules 5 to 7; the list stays only for its browser-globals check); and the `node:` parts of the per-module host tests (rules 1 and 2; their ownership checks stay). `SCENE_MATERIAL_SUPPORT` shrank to three entries. `FEATURE_CORE_LEGACY` and `EXPORTER_LEGACY` stay, because each entry carries its own removal step; all their entries sit in `legacy/eye-makeup/`.

## Mixed concerns left for later

1. **`mod-branding`** holds XF Eye Artistry's names, plus the showroom's mod name (`FINISH_SHOWROOM_MOD`) and generic presentation wording (`MOD_NAME_HINT`, used by the Expressions view). The showroom name belongs in `showroom/` and the hint in the presentation.
2. **`facial-host`** (1,065 lines) is the facial host service and its HTTP handling in one module; other subsystems split these into `-host` and `-server` modules.
3. **`desktop-app` and `studio-action-descriptors` import each other** (the descriptors list the desktop-app actions; the offer reads its descriptors).
4. **`workspace-state`** is one codec spanning preview, character, eye makeup and UI preferences; it is the hub of `app/workspace/`.
5. **`glitter-studio-flakes`** is imported by nothing in `src/`; only a test and experiment 021 use it.

## Moving another branch

`bun tools/source-layout.ts` (from `projects/xf-studio/authoring/`) moves each mapped file that still exists with `git mv`, rewrites every relative import that no longer resolves (from where its file was before the move), and rewrites `src/<old>.ts` paths in tracked Markdown, code, Python, CSS and HTML, except inside Markdown's `<!-- historical-paths -->` regions. An import that already resolves is never touched, so the script is safe to run again.

A branch that has its own new modules merges `main` after the move (edits to moved files follow the renames), then runs `bun tools/source-layout.ts --imports-only [files or folders]` to fix its own imports. To move its new flat modules too, it adds them to a copy of the map and passes `--map <file>`. `--check` reports what would change and any import of a mapped module that resolves nowhere.

Hand edits the move needed, which the script can't make:

- `desktop/prepare-static.ts` lists its browser entries by path and names their bundles by file name (`naming: "[name].[ext]"`), so the desktop page still loads `/build/studio-startup.js` and the workers.
- `host/host-code-identity` fingerprints all of `src/` (its parent's folder), not only its own.
- `host/package-server` finds the app folder two levels up.
- Tests that name modules by bare string (`source("…")`, file lists, allow-lists) use the new paths.

The move changed the host code identity once, so the first start after it prepares warm-restart answers again.
