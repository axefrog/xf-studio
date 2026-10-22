# Experiment 043: scene runtimes (profiles phase 4a)

**Status:** gap map and chunk plan, approved 22 October 2026 with decisions D1–D4 at their defaults (§4). Chunks 4a-i (§7), 4a-ii (§8) and 4a-iii (§9) are built on `claude/profiles-4a`. This is the working record for [profiles design §4.5](../../research/authoring/profiles-views-layouts-design.md#45-scene-runtimes-and-switching-phase-4a) and its phase 4a row in §9.2. It builds on spike S2 ([experiment 039](../039-view-switch-spike/README.md), prototype on branch `claude/spike-views`).

Source paths are relative to `projects/xf-studio/authoring/src/`, and line numbers are at `72369156` (phase 1 merged). Tests are in `projects/xf-studio/authoring/tests/`.

## 1. Where main stands

Phase 1 de-singletoned the data: the session, scenes with `subject`, `look` and `gen`, `CharacterService`, `LookSessions`, the focus service and named targets. The GPU side is still the single head of the view graph design §2.1, because that design's P3 (the scene-host split) was never built:

- `createSceneHost` (`platform/scene/scene-host.ts:68`) opens its own canvas and WebGL context (`:89–109`). It owns one camera and its orbit controls (`:110–117`), one scheduler (`:244–274`), resize and a `ResizeObserver` on the DOM host (`:221–232`, `:281`), and every subject resource. Its `dispose()` relies on `forceContextLoss()` (`:109`) to free GPU memory.
- `createBrowserViewportDevice` (`preview/browser/browser-viewport-device.ts:36`) holds one `viewer`, and `loadHead` releases the shown head *before* it builds the next one (`:94–98`). This is the blank pane S2 measured.
- The composition root keeps one head in root variables (`compose/studio-startup.ts:227–237`), and builds and releases it in `attachHead` and `releaseHead` (`:538–595`).
- `attachBrowserHead` (`preview/browser/browser-head-attachment.ts:114–254`) wires everything for that one head: the saved-V, preview and motion services, the character detail service (`:153`), the character context on this head's ports (`:195–200`), and the editors and layered surfaces (`:163–181`).

## 2. Gap map

Each row gives what main has, what is missing, and the risks.

### 2.1 The renderer device and per-scene runtimes

| | |
|---|---|
| **On main** | One scene host per head, which owns the context, canvas, scheduler, camera, controls, lighting stage, rig, character renderer and feature renderers (`platform/scene/scene-host.ts:81–509`). The pure scheduler (`preview/render/render-scheduler.ts`) is reusable. The feature-renderer registry is already per host and never sees a camera (`platform/scene/feature-renderers.ts`, view graph §2.15). The S2 prototype added `sharedRenderer` and `setDrawing` to the host (branch `claude/spike-views`, about 26 lines). |
| **Missing** | A `RendererDevice` per window that owns the canvas, the one `WebGLRenderer`, the one scheduler, resize and DPR, context events and the input element, and draws only the shown runtime. A `SceneRuntime` per (scene, subject, body): today's host without the canvas, renderer, scheduler, resize or observer, built on the device's renderer. The viewport device holding runtimes instead of one `viewer`. The root's head variables moving into one owner (§2.6). |
| **Risks** | *Renderer-global state* (§2.7). *Shared DOM host:* each host observes `headHost` itself (`:281`); the device must own that. *Context loss* now costs every resident runtime its GPU state: the device evicts the warm ones and restores only the shown one. *Frame-sized targets are per runtime:* the scene-linear target (`preview/render/linear-display.ts:155`), the skin scatter's three targets (`platform/scene/skin-scatter.ts:166–171`) and the contact-shadow target (`platform/scene/contact-shadow.ts:60`) would be duplicated in a warm runtime. A hidden runtime releases them, and they come back lazily on show (allocation only, no compiles). |

### 2.2 Hidden creation with an `AbortSignal`

| | |
|---|---|
| **On main** | Only the V's details take a signal (`character/character-detail-actions.ts:109`, `:158–205`). Optional renderers register with one (`feature-renderers.ts:211–214`). A failed build releases what it made (`scene-host.ts:69–79`). |
| **Missing** | A signal through `createSceneHost`, `loadCoreDetail` (fetch and its steps, `character/render/core-detail-loader.ts:58–103`), `createHeadRig` and its motion load (`platform/scene/head-rig.ts`), feature renderer creation, and `PreviewPreparationActions.ensureBody` (`preview/preview-preparation.ts:152`, which has no signal and polls up to 2,000 times). A built runtime that has no path to the canvas: the S2 prototype drew 2 stray frames because each host had its own scheduler. |
| **Risks** | *Cancel latency:* `GLTFLoader.parseAsync` and texture decode can't be stopped part-way, so abort is checked between steps, and one step (a whole-body glTF parse) may itself be a long task. The cancel gate (≤ 100 ms) is measured from abort to the last upload, as S2 measured it. *Host preparation:* when a body change is superseded, does the masculine core's host preparation (18.5 s cold) stop, or finish as a cache? See decision D1. |

### 2.3 Prepare before switching, with progress; no main-thread link stall

| | |
|---|---|
| **On main** | Detail parts are already prepared ahead (PREV-188/189). `character.prepareDetails` uploads maps a few per frame and links programs with `KHR_parallel_shader_compile` (`scene-host.ts:379–380`, `platform/scene/character-renderer.ts:184`). The lighting stage's `prepare(object, camera)` compiles an object's main, scatter and contact variants through `compileAsync` (`preview/render/lighting-setup-stage.ts:287–310`). Features use it through `SceneHostPort.compile` (`scene-host.ts:299–303`). `tools/gl-probe.ts` instruments links, waits and uploads. The performance budget allows no main-thread task over 50 ms after any click or change (`research/backlog/performance.md`). |
| **Missing** | A prepare step for the *whole runtime* for a given view: the core head and eye materials, the rig, the feature renderers' plates, every lighting setup a view of that scene shows, shadow depth variants, and the core textures uploaded. The previous view stays drawn until that step is ready. A typed preparation state (stage and fraction) that the head pane can show in place. A `device.show(view)` that phase 2's tab switch will call. |
| **Risks** | *Variants created at draw time:* the stage's own comment says shadow depth variants are built inside Three's shadow pass, so they can't be compiled ahead (`lighting-setup-stage.ts:284–285`). ANGLE on D3D11 may also build input-layout variants at the first draw. **Mitigation:** after async compile, draw the runtime once, hidden, into a small offscreen target, so those costs land in a hidden frame and never in the switch. Whether that is enough is a GPU question for run G2 (§5). *Blocking status queries:* Three's `checkShaderErrors` reads a program's link status, which waits for the driver; it must only read once `COMPLETION_STATUS` says the link is done. *The cold 94 s* (fresh Chrome profile, 40 programs) is moved off the main thread and behind progress, not removed. Its size stays a performance-track item. *The 1.14 s stall after a resident's first draw* came from deferred uploads, so prepare must upload the core textures too, not only the details. |

### 2.4 Residency: the shown runtime plus at most one warm one; leak-free disposal

| | |
|---|---|
| **On main** | Nothing is resident besides the one head. `tests/webgl-scene-host.test.ts` already checks, within one host, that V switches and cleared makeup layers return `renderer.info.memory` to where it was (synthetic head, real GPU, skipped in public CI). |
| **Missing** | A residency policy (the shown runtime plus at most N warm ones, N = 1 by default and tunable, least recently shown evicted first), with an explicit state per runtime. Disposal that frees everything on a renderer the runtime doesn't own. A test that opens and closes runtimes on one renderer and finds the GPU objects back where they were. |
| **Risks (leaks, found by reading the code)** | On success, `loadCoreDetail` hands its textures and glTF geometries to the rig, and nothing disposes them (`core-detail-loader.ts:96`; the rig releases only the anchor and eye materials, `head-rig.ts:209`, `:234`). The head's skin material is never disposed either (`head-rig.ts:216–223`). All of this was freed only by `forceContextLoss` (`scene-host.ts:109`). That is a likely cause of most of S2's 7–9 textures and about 220 MB of VRAM left behind per closed resident. While those materials and geometries stay alive, Three keeps their programs and vertex-array objects too, which fits the heap left behind (about 200 MB). Other leaks are unknown, so the test counts GL objects directly: it wraps `create*`/`delete*` for textures, buffers, framebuffers, renderbuffers, programs and vertex arrays. `renderer.info` alone misses programs and framebuffers. *GPU memory:* a resident whole-body V costs 0.7–1.2 GB of VRAM and 1.2–2.1 GB of GPU-process memory (S2), so on a 4 GB card one warm whole-body V may already push the shown one into shared memory or a context loss. **Mitigation:** N is a budget; a context loss or a failed allocation drops warm runtimes first; residency cost is reported as evidence. A byte cap waits until there are measurements (decision D2). *Program growth:* each masculine head added 21 programs to 55. Programs are freed only when no material uses them, so disposal must free every material. |

### 2.5 The superseding subject change replaces `reloadHead` and `not_ready`

| | |
|---|---|
| **On main** | A body change works like this. The character context's `shownBody` changes, the head attachment asks for a reload a turn later (`browser-head-attachment.ts:233–242`), and the root snapshots the whole workspace into `headWorkspace` and calls `previewSetup.reloadHead()` (`studio-startup.ts:554`). That call does nothing while a load is under way (`preview/preview-setup.ts:363–372`), so the superseding choice is lost. Meanwhile `loadHead` releases the shown V first (the blank pane). The context is detached and recreated per head (`character/character-service.ts:195–215`, `:232–235`), and its history survives. Requests made during the reload are refused with `not_ready` ("The creator options are still loading."). |
| **Missing** | A per-scene subject change that supersedes: the scene wants (subject, body); the newest want builds or reuses a runtime; anything older is aborted; nothing older is ever shown; the previous runtime stays drawn, with progress, until the new one is ready. The character context outlives runtimes: one context per V, with its scene ports bound late to the runtime shown. **Motion settings in the scene node.** Idle, clip, pause, contributions, blink and pose are still `MotionActions` state in the workspace's `preview` block, restored per head (`animation/motion-actions.ts:111–118`, `:208`). The reload carries them only through the `headWorkspace` snapshot. A new runtime of the same scene has to read them from the graph instead (view graph §6.5 already planned this move "when the rig becomes the scene runtime's"). The camera has the same problem: an orbit doesn't write the camera node (`browser-head-attachment.ts:246–248` only persists), so a swap would lose the pose. |
| **Risks** | *One context per V on the first scene's ports* (`character-service.ts:195`): with a building runtime and a shown one for the same V, the context's `showSave`, `details` and `previews` ports must follow whichever runtime the scene shows, never both. A warm runtime stops following its V, and catches up when shown again (the detail service already supersedes). *Restore order:* today it is saved V, then optics, eye shape and details, then motion, then camera (`app/trusted-preview-services.ts:16–83`). It must hold per runtime, without the hard-coded `MAIN_VIEW` seeds (`:71–72`). *The eye-makeup editor and layered surfaces* are bound to one head (`browser-head-attachment.ts:163–181`), and the masculine plate is another mesh. A swap first settles any open gesture, then rebinds. *Workspace format:* motion moving into the scene node keeps the legacy `preview` mirror, so older builds read it (§2.4 of the design). |

### 2.6 Input to the drawn view only; each runtime sets its own renderer state

| | |
|---|---|
| **On main** | Camera input is bound per canvas through the binding catalogue (`preview/render/head-camera-input.ts`), on the host's own canvas (`scene-host.ts:114–117`). The viewport attachment is keyed by host and slot (`app/viewport-attachment.ts:16`). Renderer-global state is set once at creation (`scene-host.ts:105–107`) and by the lighting stage per draw for some fields (`lighting-setup-stage.ts:174`, `:224`, `:270`, `:300–309`). |
| **Missing** | Controls and camera input attached to the canvas only while their runtime is drawn (the S2 prototype disabled the hidden one), with the camera pose restored from the view's camera node on show. Every draw opening by applying the runtime's full renderer-state record: tone mapping, exposure, clear colour, output colour space, shadow-map enabled, type and `needsUpdate` (from the runtime's own pending flag), render target null, size and pixel ratio from the device. |
| **Risks** | `renderer.shadowMap.needsUpdate` is global and set from each stage's own key (`lighting-setup-stage.ts:270`). If runtime B draws first, A's pending shadow update is consumed and A shows stale shadows when it comes back. The same holds for exposure on the studio display (`:224`) and the clear colour. **Gate:** draw A, then B, then A, and A's pixels are byte-identical (a GPU probe). *A full view-runtime split* (cameras and controls owned per view, view graph §3.3) is deliberately left to 4b. With one drawn view, a runtime-owned camera attached only while drawn is the simpler design that is just as robust (decision D3). |

### 2.7 The S2 gates in CI form

| | |
|---|---|
| **On main** | `experiments/039-view-switch-spike/measure.ts` drives the spike's verify-only page through a real server and the real installation. The GPU probe framework (`tests/webgl-harness.ts`, synthetic heads in `tests/webgl-scene-host-probe-page.ts`) runs on a local Chrome, is skipped in public CI, and fails with `XFS_REQUIRE_ORACLES=1`. `tools/scene-parity.ts` compares the drawn head byte for byte. `tools/gl-probe.ts` instruments the GPU. |
| **Missing** | Three tiers. **T1, pure tests** in the public suite: the residency and supersession state machine with an injected clock (last choice wins, cancel timing, no late result, warm reuse, eviction order, close), and the renderer-state contract against a recording fake renderer. **T2, a GPU probe** on synthetic heads of both bodies (no game files): stray frames counted per runtime and checked by canvas checksum, warm switch time, the longest main-thread task during a switch, A-B-A pixel identity, and GL object counts back to baseline after open and close. **T3, the real-data harness:** 039's `measure.ts` ported to the production API, for the development machine. |
| **Risks** | T2 can't read VRAM. It counts GL objects and bytes per texture instead, and T3 reads VRAM from the OS, as S2 did. The CI runner has no GPU, so only T1 runs in CI. T2 and T3 are release-gate oracles (`XFS_REQUIRE_ORACLES=1`), like today's WebGL probes. |

### 2.8 Routing view actions by their named view; UI-boundary exception 17

| | |
|---|---|
| **On main** | Camera, motion, and the preview's eye shape, detail and hair refuse any view that doesn't show the drawn scene (`preview/preview-actions.ts:131–132`, `:208–211`, `:242–244`; `animation/motion-actions.ts:94`, `:177–178`; `app/trusted-preview-services.ts:66`). Exception 17 (`research/authoring/ui-architecture-boundary.md:127`) covers the root wiring the UV and on-head editors' hooks (`studio-startup.ts:376–402`) and the save and preset loaders (`:430–444`, where `ready` is `!!scene`). |
| **Missing** | The application routes each view action to the runtime of the named view's scene. A view whose scene is resident gets the full action. For a view whose scene isn't resident, graph edits apply (restore, navigate, Back and Forward, light and display settings), and device-computed jumps (Front view, Whole body, the creator cameras) refuse with `not_ready` and the reason "This view's V is still loading" until that scene is prepared. The `NOT_DRAWN` refusals and `drawsScene` are removed. The editors' adapters move into a per-view binding module (`preview/browser/scene-editors.ts`) that binds each view's editor to that view's resolved look. The loaders name their V and dispatch `character.setSource`, with readiness per scene. Exception 17 is then removed. The UV editor is a panel, not a view, until view graph P6, so only the part of its wiring that names the drawn scene moves. |
| **Risks** | The application's single `preview` and `motion` attachments (`attach({ preview, motion })`) become a lookup by scene. Every caller that assumes one has to move with it, and `tests/profiles-no-default-boundary.test.ts` and `tests/view-graph-audit.test.ts` (`SCENE_HOST_IMPORTERS`, `:28`) must say so. |

### 2.9 Not in 4a (noted, not planned)

- **Workspace takeover in place:** design §2.3 says "Takeover restarts the page, until scene runtimes (phase 4a) allow switching in place". The phase 4a row doesn't list it, so it is left as a follow-up that 4a makes possible.
- **Sharing immutable per-body assets** (the core head's textures and geometry) between runtimes of the same body. In 4a the warm runtime is usually the other body, so the saving is small. It is worth measuring in phase 5, when several Vs are open.

## 3. Chunk plan

Effort is in the design's units. Each chunk leaves `main` green (suite, typecheck, build), has one Sol review, and is merged by the coordinator. The UI changes in 4a-v go through the UI review, with light and dark captures at narrow and wide panels.

| Chunk | Scope | Gates | Effort | Depends on |
|---|---|---|---|---|
| **4a-i: Leak-free disposal and GPU accounting** | Every runtime-made GPU resource is disposed without context loss: core textures, geometry and skin material, the rig's motion resources, frame targets, PMREM, shadow maps, and the character and feature renderers. A GL-object counter for probes. `createSceneHost` takes an optional injected renderer (default unchanged). | T2: open and close a host on one renderer ×5, synthetic head. GL objects, `renderer.info` and program count are back at baseline. Existing WebGL probes unchanged. | 1–1.5 | — |
| **4a-ii: Renderer device and hidden runtimes** | `platform/scene/renderer-device.ts`: canvas, renderer, scheduler, resize and DPR, context events, and drawing only the shown runtime. `SceneRuntime` is today's host minus those, built hidden, with an `AbortSignal` through core, rig, motion and features. Per-draw renderer-state record. Controls attached only while drawn, with the camera pose from and to the camera node. One runtime in production, behaviour unchanged. The root's head variables move to the viewport device. | T1: renderer-state contract. T2: a runtime built while another shows draws 0 frames and leaves the canvas checksum unchanged; A-B-A pixels byte-identical; abort at each build step releases everything (GL counts at baseline). G1: scene parity byte-identical. | 2–2.5 | 4a-i |
| **4a-iii: Motion settings into the scene node** | Idle, clip, pause, contributions, blink and pose become scene-node state in the graph, with View and lighting history as today. `MotionActions` reads and edits the node. The legacy `preview` fields are read once and written back as read, for older builds (§9). | T1: workspace fixtures round-trip byte-identical when nothing changed; an older-build reader test; restore order unchanged. | 0.75–1 | — (alongside 4a-ii) |
| **4a-iv: Residency and the superseding subject change** | A DOM-free residency owner: per scene, a wanted (subject, body); runtimes moving through building, preparing, ready, shown, warm and disposed; N warm (default 1, tunable); least recently shown evicted first; supersession by `AbortController`, with a generation check so no late result is shown. The character context outlives runtimes, and its scene ports follow the shown runtime (`CharacterService.detach` goes). Warm runtimes stop following and catch up on show. **`reloadHead`, `headWorkspace` and the `not_ready` refusal are removed.** `PreviewSetupActions` keeps only first-run setup. `ensureBody` takes a signal. | T1 (model-based, seeded): random body and V changes with cancels, where the last choice is always shown, nothing superseded is shown, cancel is ≤ 100 ms on the injected clock, the warm runtime is reused, and eviction and close dispose. T2: female, male, then female 150 ms later shows female; closing a subject returns GL counts. | 2 | 4a-ii, 4a-iii |
| **4a-v: Prepare before switching, with progress** | `runtime.prepare(view, signal)`: async compile of the whole scene for each lighting setup its views show (main, scatter, contact and shadow variants), core and detail textures uploaded a few per frame, then one hidden warm-up draw into a small offscreen target. A typed preparation state. The head pane keeps the previous V drawn and shows progress in its existing quiet overlay (`studio-ui/panels/viewports.ts:111–115`), with no new component expected. `device.show(view)` with the same rule, for phase 2's tabs. | T2: warm switch ≤ 100 ms to the first presented frame; no main-thread task over 50 ms from the request to 1 s after the switch; programs and uploads during the shown frame are 0. G2: the same on real data with a fresh Chrome profile (cold program cache). UI review PASS. | 1.5–2 | 4a-ii (the API); 4a-iv (wiring) |
| **4a-vi: Routing by named view, exception 17, gates and records** | View actions routed to the named view's runtime, with the `NOT_DRAWN` refusals, `drawsScene` and the `MAIN_VIEW` seeds removed. Editors bound per view (`preview/browser/scene-editors.ts`). Loaders through `character.setSource` with readiness per scene. Exception 17 removed. `tests/webgl-scene-runtimes.test.ts` (T2), and `measure.ts` in this folder (T3). Records: design §4.5 "Built in phase 4a", view graph status, boundary record, action catalogue, and a knowledge page on program linking and residency in WebGL. | T1 in CI. T2 and T3 as release oracles. The no-default boundary test and the view-graph ratchet updated (the scene-host importer list shrinks). G3: the full S2 gate table, on real data. | 1.5–2 | 4a-iv, 4a-v |
| **Total** | | | **8.75–11** | |

**Against the design's 7–9.** The estimate is higher for two reasons. First, the motion settings move into the scene node (4a-iii). That is what lets `reloadHead`'s workspace snapshot go rather than live on, and the design's estimate didn't include it. Second, the leak audit found that disposal depended on context loss throughout, not in one place. 4a-iii can run alongside 4a-ii, and 4a-v's runtime half alongside 4a-iv, so with two agents the elapsed time is about three quarters of the total.

**Reductions as the work migrates:** `reloadHead` and its refusal, `headWorkspace`, `CharacterService.detach`, the root's head variables and `attachHead`/`releaseHead`, `NOT_DRAWN`, `DRAWN_CHECKS` and `drawsScene`, the `MAIN_VIEW` seeds in `trusted-preview-services.ts`, and exception 17.

## 4. Decisions

All four were approved at their defaults by the coordinator on 22 October 2026, with the plan. Chunks run one at a time (economical mode), so 4a-iii follows 4a-ii rather than running beside it.

| # | Question | Decided |
|---|---|---|
| D1 | When a masculine body change is superseded, does the host's core preparation (18.5 s cold, one-time) stop? | It stops. The page withdraws its want, and the job scheduler cancels work nothing wants (architecture contract). The next masculine request starts again. |
| D2 | Is the residency budget a count, or bytes too? | A count (N = 1), plus: warm runtimes are dropped first on context loss or a failed allocation, and each runtime's estimated bytes are published as evidence. A byte cap waits for G3's measurements. |
| D3 | Camera per runtime or per view in 4a? | Per runtime, attached only while drawn, with the pose kept in the camera node. View runtimes (several cameras over one scene) come in 4b. |
| D4 | Workspace takeover in place (design §2.3)? | Not in 4a; a follow-up. |

## 5. GPU runs the coordinator schedules

None ran in this planning pass. Memory figures are guard limits. Durations include the server's start on a warm preview cache.

| Run | When | What | Memory | Duration |
|---|---|---|---|---|
| **T2 probes** (synthetic heads, no game files) | Every chunk from 4a-i, during development | `bun test tests/webgl-scene-host.test.ts tests/webgl-scene-runtimes.test.ts` under the guard | Expected under 1.5 GB (bun plus one headless Chrome, small synthetic textures). Confirm on the first run with `--limit 3`; ask for 4 if it is killed. | 1–3 min each |
| **G1: scene parity** | End of 4a-ii | `tools/scene-parity.ts` against main: 20 frames, both lighting presets, 1K and 2K, real V, isolated server (039's environment variables, its own port, scratch caches) | Server `--limit 3` (S2 peaked at 1.8 GB), Chrome `--limit 4`. About 7 GB together. | 10–15 min |
| **G2: first draw on a cold program cache** | End of 4a-v | `measure.ts` in this folder, switch part only, with a fresh Chrome profile: a lighting setup and a body never drawn before, with long tasks, links and uploads (`gl-probe.ts`) | Server 3, Chrome 4 (head only). About 7 GB. | 10–15 min (the cold link alone was 94 s in S2) |
| **G3: the full S2 gate table** | End of 4a-vi, before merge | `measure.ts` in this folder: views, subjects, residency and memory, on real data, warm cache and then a fresh profile. **Whole-body part:** two whole-body Vs resident in one page. | Head-only parts: server 3, Chrome 4. **Whole-body part: Chrome 6** (S2's run 3 was killed at 4.1 GB under 4). Up to about 9 GB together, more than the free margin above the 16 GB floor, so other chats' memory has to be lowered for its window. | 20–30 min |

Each real-data run uses an isolated server and scratch caches, as S2 did: never port 4317 or 4331, never the maintainer's library or workspace. G1–G3 need the masculine core prepared once (18.5 s cold).

## 6. Open risks, ranked

1. **Variants built at draw time** (shadow depth, ANGLE input layouts) defeat compile-ahead. The hidden warm-up draw is the mitigation; G2 decides whether it is enough.
2. **GPU memory of a warm whole-body runtime** on smaller cards. It is a tunable budget, warm runtimes are dropped first under pressure, and the cost is measured in G3.
3. **Unknown leaks beyond those read in the code.** The GL-object count in 4a-i finds them, rather than relying on `renderer.info`.
4. **Renderer-global state between runtimes** (shadow `needsUpdate`, exposure, clear colour). Every draw opens with the runtime's full state record, and the A-B-A pixel gate checks it.
5. **Cancel latency inside one non-abortable step** (a whole-body glTF parse). Abort is checked between steps; if G3 shows a step over 100 ms, that step is sliced or moved to a worker.
6. **The context outliving runtimes** changes the character service's lifecycle (detach goes). The model-based T1 test in 4a-iv covers interleavings, and the multi-subject service test grows to two bodies resident at once.

## 7. Chunk 4a-i: disposal without context loss (built)

**What changed.**

- The scene host can draw on a renderer it doesn't own, and never disposes it or moves its canvas. In 4a-ii that renderer became the renderer device's (§8).
- **The core head goes with its host.** `coreDisposer` (`character/render/core-detail-loader.ts`) captures, at load, every geometry, material, texture and skeleton of the core's glTF scene, plus its record's textures. The host frees them in its release list. The failure path in the loader uses the same function.
- The rig frees the head's skin material, and the skinned eye copy the game idle makes for gaze (its geometry and skeleton) (`platform/scene/head-rig.ts`).
- **The makeup stack's geometry waits for its anchor.** It draws over the plate anchor's index and attributes, and the anchor is never drawn (PREV-97), so those buffers were uploaded through the stack's geometry. Three frees an attribute's buffer only when a geometry it drew is disposed. The stack used to strip the shared attributes before disposing, which left the anchor's buffers on the renderer for good. Now its geometry is disposed whole when the anchor's geometry is (`engines/layered-makeup/render/makeup-stack.ts`).
- **Full-skin shadow depth materials have an owner** (after Sol's review). The character renderer makes one per shadow-casting skinned mesh (`fullSkinDepthMaterial`, `materials/render/skin.ts`), after the core disposer has captured the core's materials, and nothing disposed them. Each one kept its program's use count up, and a different variant kept a program of its own. The mesh owns its material: `releaseFullSkinDepth` frees it with the mesh. The detail loader's `releaseDetailObject` calls it for every released part, and the character renderer's `dispose` calls it for the core head. A JSON copy left in a cloned mesh's user data is never taken for the material.
- The studio environment's prefilter also disposes the room's instanced boxes. Three's `RoomEnvironment.dispose()` frees the geometry and materials but not the instance-matrix buffer, so one buffer was left per prefilter and per context restore (`preview/render/studio-environment.ts`).

**The counter and the gate.**

- `tests/webgl-gl-objects.ts` wraps a WebGL 2 context's `create*`/`delete*` calls and counts live textures, buffers, framebuffers, renderbuffers, programs, shaders, vertex arrays, queries, samplers and syncs. With `stacks` it records the call stack that made each object, so a leak can be traced to its maker.
- `tests/webgl-scene-dispose.test.ts` (page `tests/webgl-scene-dispose-probe-page.ts`) builds the real host five times on one renderer it doesn't own. Each cycle uses the synthetic head (`tests/webgl-synthetic-head.ts`, now shared with the scene-host probe) and the composition's renderers. It shows a synthetic V with two makeup layers, draws under the creator rig (shadows, scatter, grading) and a studio setup (the room environment), plays the idle, then disposes the host as it is.
- **The program check** (after Sol's review). Object counts alone miss a material that outlives its scene when an identical program means nothing new is made: the program stays, with a higher use count. So the probe also reads `renderer.info.programs`: each program's name, use count and a hash of its cache key. Odd cycles show a head with two skin influence sets, so their skin and full-skin depth programs differ from the even cycles' (the test checks that they do).
- The first disposal may leave only what lives as long as the renderer (the test's `RENDERER_LIFETIME`), down to the one program and its use count. Every later disposal must leave exactly what the first did: the same objects, programs and use counts. A scene shown again must cost what the same variant cost before.
- It runs as a release oracle, like the other WebGL probes (`XFS_REQUIRE_ORACLES=1`). Headless Chrome on a synthetic head peaked at 1.2 GB under the 3 GB guard. It ran in 60–120 s depending on the machine's load, so the page timeout is 240 s.

**Counts after each disposal, minus the empty renderer's** (RTX 4070, ANGLE D3D11):

| After cycle | Before (main) | After 4a-i |
|---|---|---|
| 1 | 10 textures, 23 buffers, 3 programs, 3 vertex arrays | 3 textures, 3 buffers, 1 program, 1 vertex array |
| 2 | 17, 43, 3, 5 | 3, 3, 1, 1 |
| 5 | 38, 103, 3, 11 | 3, 3, 1, 1 |
| Growth per cycle | +7 textures, +20 buffers, +2 vertex arrays (Three: +2 geometries, +7 textures) | none |

**Programs left after each disposal, with the alternating heads**, measured after the first review fixes, before the depth-material fix:

| After cycle (influence sets) | Before | After |
|---|---|---|
| 1 (1) | `BackgroundMaterial` ×1; full-skin depth ×1 | `BackgroundMaterial` ×1 |
| 2 (2) | plus the second variant's full-skin depth ×1 | `BackgroundMaterial` ×1 |
| 5 (1) | full-skin depth ×3 and ×2 | `BackgroundMaterial` ×1 |

Before the fix, per cycle, the leaks traced to:

- the core head's four textures and its geometries;
- the skeletons' bone textures (two);
- the plate anchor's six buffers held through the makeup stack;
- the room environment's instance buffer;
- the full-skin shadow depth materials and their programs.

The first gate missed the last one: its program kept the same count of GL objects, and the gate wrongly listed it as Three's own shadow program.

What stays after the first cycle is shared by every later scene and freed only with the renderer. Three owns most of it: its DFG lookup texture and the background plane it draws a textured scene background with (three buffers, one vertex array, one program). The layered-makeup engine owns the rest: its 1×1 blank textures, shared on purpose (`plate-composite.ts`).

**Not covered yet.**

- **JS heap:** this gate counts GPU objects, not memory. S2's 200 MB of heap left behind is measured again in G3.
- **The real masculine and feminine cores:** these use the same code path, but their counts come from G1–G3.
- **The game idle's gaze-eye copy:** the synthetic idle doesn't make one, so the probe doesn't exercise that release.
- **A replaced skin underlay of a different vertex count:** that case still waits for renderer teardown (`applyUnderlay`). It doesn't arise today, because the plate's vertex count never changes.

## 8. Chunk 4a-ii: one renderer device, runtimes built hidden (built)

**What changed.**

- **The renderer device** (`platform/scene/renderer-device.ts`), one per window's 3D pane. It owns the canvas and the one WebGL context and `WebGLRenderer` (the opaque, preserved, half-float-checked context the scene host used to open), the one render-on-demand scheduler, the pane's size (its `ResizeObserver`) and device pixel ratio, context loss and restore, and the canvas as the input element. Runtimes are added to it hidden (`device.add`, which gives each a `DeviceSlot`) and drawn only once shown (`device.show(slot)`). A hidden runtime's frame requests wait; showing one draws it. With nothing shown the canvas is hidden, so a released head leaves the pane as it did when its own canvas went. A probe may hand the device a context it made (`options.context`), so the context's calls are counted before Three makes anything.
- **The scene host is a scene runtime** (`createSceneRuntime(device, options)` in `platform/scene/scene-host.ts`; type `SceneRuntime`). It keeps the scene, its camera and controls, the stage, the lighting, the core head, the rig, the character renderer and the feature renderers. It lost the canvas, the context, the scheduler, resizing, the pane observer and the pixel-ratio watch. Its own context path is gone: 4a-i's `renderer` option became the device. `frameTiming().frames` counts this runtime's drawn frames, and `running` is false while it is hidden. `dispose()` leaves the device (hidden first if shown) and never touches the renderer, its canvas or its context.
- **On the device from the start.** A runtime adds its hidden slot to the device before it makes anything, so a context restore reaches whatever it has built so far (nothing, then the lighting, then everything). The device never shows a slot until its owner calls `show`, which happens only after the build. `dispose()` removes the slot first.
- **Built hidden, with an `AbortSignal`** (`options.signal`), checked between steps:
  - before anything is made, and after the lighting stage;
  - inside `loadCoreDetail`, after the record, the geometry's bytes, its parse and the textures (an abort passes through as itself, not as a damaged preview), and again after the core;
  - inside the rig's motion (`MotionLoader` takes the signal; `loadGameMotion` checks it after the idle source and after the blink, and never turns an abort into the idle's error), and again after the rig;
  - before each feature renderer (`createFeatureRenderers`), and once the runtime is built.

  A step already running (a glTF parse, a decode) finishes first. An abort releases what was made, as any failed build does. Any step that fails after the signal has aborted rejects with `signal.reason`, whatever it threw, so a superseded build never surfaces as a damaged or unreachable preview. `PreviewPreparationActions.ensureBody` still takes no signal (4a-iv).
- **Each draw sets its own renderer state** (`platform/scene/renderer-state.ts`). `RendererState` is the record of the renderer-global fields: tone mapping, exposure, clear colour and alpha, output colour space, and the shadow map's switch, type and auto-update. `applyRendererState` writes all of them and sets the canvas as the target. The lighting stage holds its scene's record and no longer writes the renderer when it is made or when a setup changes (the studio exposure used to go straight to `renderer.toneMappingExposure`). It applies the record at the start of every draw (the runtime's `draw` opens with `lighting.applyRendererState()`) and of every compile ahead (`prepare`), because Three keys programs on these fields. The shadow maps' redraw is the scene's own flag, set true or false on every draw from its fingerprint, never left over from another scene's frame.
- **Camera input reaches only the shown runtime** (decision D3). Each runtime makes its controls without an element. When the device shows it, it connects them, with a fresh binding-catalogue input (`attachHeadCameraInput`); when hidden, it disconnects them. The surface editor's target resolver is kept across shows. A hidden runtime's disposal never touches the canvas's cursor or touch action.
- **The viewport device holds the device** (`preview/browser/browser-viewport-device.ts`). It makes the device with the first head and builds each head on it with a signal: a newer load or a release aborts a build still running, and a head superseded on its last step is disposed, never shown. Then it shows the head. One head is drawn, and it is released before the next is built, as before. Tests stand in for the device through `deviceFactory`.
- **The root keeps one head variable** (`compose/studio-startup.ts`): the saved-V, preview and motion services are read from `head`, so `savedAppearance`, `previewActions` and `motionActions` are gone. `scene` (a mirror of `head.scene` for the developer evidence), `attachHead`, `releaseHead` and `headWorkspace` go with the superseding subject change (4a-iv).
- **Callers moved.** The probe pages (`webgl-scene-host`, `webgl-body`, `webgl-clothing`, `webgl-scene-dispose`), `tools/depth-study.ts` and `tools/glitter-head-study.ts` make a device and show one runtime on it. `bindRenderTriggers` takes any of controls, canvas and lighting: the device binds its canvas, and each runtime its controls and lighting.

**Gates.**

- **T1, the renderer-state contract** (`tests/renderer-state.test.ts`, a recording fake renderer). A record sets every field. Two lighting stages on one renderer draw A, then B, then A, each with its own exposure, tone mapping and clear colour, whatever was left on the renderer in between. Making a stage writes nothing to the renderer, and each scene's shadow redraw is its own. Both tests fail on the code before this chunk.
- **T2, the device probe** (`tests/webgl-renderer-device.test.ts`, page `tests/webgl-renderer-device-probe-page.ts`, synthetic heads, one counted context):
  - builds aborted before they start, in the core head, in the motion and among the feature renderers, and a core loader that throws its own error after the abort (`core-failing`), reject with `AbortError`, and leave the GL objects and Three's programs where they were;
  - runtime B, built, given a V and its parts prepared ahead (programs compiled, maps uploaded) while A is shown, draws no frame and leaves the canvas byte-identical. A runtime composites its makeup only in a drawn frame, so the probe composites B ahead through its makeup renderer's own `beforeDraw` and checks the composite ran (layer draws 0 to 1) before checking the canvas; preparing a whole runtime ahead is 4a-v;
  - a context lost and restored while B is still being built (inside the core load, after the room was prefiltered) leaves B, once shown, byte-identical to the same runtime built on an undisturbed context;
  - A, then B (another V under another exposure), then A draws A byte-identically, and only the shown runtime draws;
  - a wheel on the canvas moves only the shown runtime's camera;
  - two resident runtimes, disposed, leave the device's canvas (hidden), its context alive and the GPU objects where the first disposal left them, and the device draws the next runtime.
- **T3, aborts reject with the abort** (`tests/scene-build-abort.test.ts`): a core record whose read is rejected, or answers 404, after the abort; the motion; and the feature renderers. Each rejects with the signal's reason.
- **4a-i's disposal gate on the shared device** (`tests/webgl-scene-dispose.test.ts`): the page builds its five runtimes on one renderer device with a counted context, showing each.
- **The existing probes and tests** move to the device with unchanged assertions, apart from the scene host probe's teardown (the runtime leaves the device's canvas, hidden; the device takes it).

**Results** (22 October 2026; RTX 4070, ANGLE D3D11, headless Chrome; every run under the 3 GB guard, peaks 0.5–1.4 GB):

| Gate | Result |
|---|---|
| T1 renderer-state contract | 2 of 2 pass |
| T2 aborted builds (before, core, motion, features, core-failing) | each rejects with `AbortError`; GL objects and programs equal to the warm baseline after each |
| T2 hidden build | B drew 0 frames while built, given a V and prepared; its composite ran ahead (layer draws 0 to 1); A drew no extra frame (2 before, 2 after); canvas checksum unchanged (96 × 96 RGBA, `ef834a41` before and after) |
| T2 restore during a build | B shown after a loss and restore inside its core load is byte-identical to B built undisturbed (`36864:dc07d1e` both). Delivering the restore only once shown fails the test |
| T2 abort, `core-failing` | rejects with `AbortError`, not the loader's `TypeError` |
| T3 aborts reject with the abort | 3 of 3 pass |
| T2 A, B, A | A `ef834a41`, B `b0b55201`, A again `ef834a41`: byte-identical over 36,864 bytes. B drew 0 frames while hidden and A 0 while B was shown |
| T2 A, B, A, negative check | with the old behaviour put back for one run (the stage writes its exposure to the renderer, the draw doesn't restore it), the A-B-A test fails; the other five pass |
| T2 input | a wheel moved only the shown runtime's camera, with A shown and then with B shown |
| T2 disposal of two resident runtimes | canvas kept (hidden), context alive, GL objects and programs equal to the warm baseline, the next runtime draws |
| 4a-i disposal gate, now on the device | 4 of 4 pass. After every cycle, beyond the empty renderer: 3 textures, 3 buffers, 1 program, 1 vertex array (the renderer-lifetime objects of §7), with only `BackgroundMaterial` used once; 16–17 frames per cycle |
| The other WebGL probes | scene host 7, body 6, clothing 7, studio lighting 4, display 12, eye 5, plate composite 8, contact shadow 3, skin scatter 8, choice preview 6: all pass |
| Scene, view, preview, character, viewport, render, lighting, parity and boundary tests | 75 files, 749 pass, 0 fail |
| `bun run check` | passes |

G1 (scene parity on a real V) has not run.

**G1, scene parity on a real V** (not run here; the coordinator schedules it). It compares this branch with `main` at the merge base, using `tools/scene-parity.ts` on an isolated server as S2 ran it: never port 4317 or 4331, never the maintainer's library or workspace.

1. In a checkout of the base, and then in this worktree, start an isolated server on its own port with scratch caches (039's environment variables), under `memory_guard.py --limit 3`.
2. On the base, run `bun tools/scene-parity.ts capture <evidence/screenshots/043-g1/base-1> <port>` twice (`base-1`, `base-2`: the first creator frame can differ between runs of one build). On this branch, run `capture <…/after> <port>`. Chrome runs under `--limit 4`.
3. Run `bun tools/scene-parity.ts compare <…/after> <…/base-1> <…/base-2>`. Every frame (five looks, both lighting presets, 1K and 2K: 20 frames) must be identical to one base capture. The outputs are private renders; keep them in the ignored `evidence/screenshots` tree.

**What 4a-iii and 4a-iv need from this.**

- **The camera pose to and from the camera node** (the second half of D3) is not wired. With one runtime nothing is swapped, so an orbit still persists only through the live `cameraState()`. When a runtime is hidden for another (4a-iv), its pose must be written to the view's camera node (`PreviewActions` already has the unrecorded `cameraMoved` path), and a runtime shown again must take the node's pose. Writing on hide and reading on show avoids a graph edit for every orbit step.
- **The surface editor binds once, to the drawn runtime,** and its listeners sit on the device's canvas. A swap must settle any open gesture and rebind it (§2.5), with the layered surfaces.
- **Context restore** reaches every runtime on the device. 4a-iv's residency drops the warm ones first instead.
- **Supersession.** The viewport device's controller is the seed of the per-scene want. 4a-iv replaces "release, then build" with "build hidden while the previous one stays shown", which the device already allows, and adds the signal to `ensureBody`.
- **Motion** was still `MotionActions` state in the workspace's `preview` block after this chunk; 4a-iii moved it into the scene node (§9).

## 9. Chunk 4a-iii: motion settings in the scene node (built)

**What changed.**

- **The motion is scene data** (`animation/scene-motion.ts`). `SceneMotion` holds the idle's on/off, phase (`idleTime`), pause and contributions, the game's preview idle that plays (`idleClip`, absent for the close-up), the closure and Play blink, and the held pose. It is plain, validated and normalised data, under the rules the workspace reader always applied: while the idle plays the blink is open and still; while it doesn't, it isn't paused. It lives in the view graph's scene node as `SceneState.motion` (`preview/preview-view-graph.ts`), so it is stored with the profile session's graph.
- **Motion records nothing in View and lighting.** `NodeCodec` gained `unrecorded` (`platform/api/view-graph.ts`), and the scene codec lists `motion` there. A motion edit carries no label, so it records no step. An Undo or Redo of another scene setting (eye shape, hair physics) restores the node with its unrecorded fields as they are now (`ViewGraph.keepUnrecorded`). Without this, undoing an eye-shape change would also have put back the idle as it was then.
- **`MotionActions` holds no settings** (`animation/motion-actions.ts`). It is `new MotionActions(port, scene)`, where the `MotionScene` port reads and stores the drawn scene's motion. In the Studio that port is `graphMotionScene(graph, preview, view)` in `app/trusted-preview-services.ts`; fixtures use `localMotionScene()`. The service keeps only what the device is doing now: an idle loading, a pose loading or playing. Changes behave as follows:
  - Every dispatch stores the changed settings, with the device's idle state and phase at that moment, as an applied, unrecorded edit.
  - `restore()` applies the node's motion to a head built for the scene. The order is unchanged: contributions, the idle's clip, the idle, then its phase and pause, else the blink. What the device couldn't take is stored back as restore-time state (`seed`), as the workspace used to save it: an idle or blink not prepared on this computer, or an idle it doesn't have.
  - `release()` stores the idle's phase. The head attachment calls it before the scene goes (`preview/browser/browser-head-attachment.ts`), so the scene's next head starts where this one was. It also ends the service: an idle load, its rollback or a pose still under way never reaches the device or the scene again, and the service refuses actions (`RELEASED`). Without this, a released head's late load failure reset the shared node to the close-up while its replacement played the chosen idle.
  - `sample()` reads the playing idle's phase into the node for a save. The workspace composer calls it (its `sample` port) before every capture, so autosaves and the flushes on close and reload store the live phase. It goes through `ViewGraph.sample`, which takes only a codec's `unrecorded` fields and records and publishes nothing, so a save never asks for another save.
- **A damaged optional scene setting never costs the graph.** The scene codec still refuses invalid values on an edit. On read, `recoverScenes` (`preview/preview-view-graph.ts`) recovers each character scene's optional settings first: each damaged motion field goes back to its default (`recoverSceneMotion`), a damaged idle choice or pose is left out, a motion that isn't an object is left out, and a damaged optional switch (`eyeOwnRoughness`, `uncensored`, `physics`) is left out. Before this, one out-of-range closure in a second scene rejected that scene, the graph fell back to the default one-view graph, and the next save made the loss permanent. Both the session's graph (`workspaceViewGraph`) and the legacy `views` field (`parseWorkspace`) read this way.
- **The workspace no longer carries motion.** `WorkspaceComposer` lost its `motion` port. The `preview` block's motion fields are written back exactly as they were read, and the root no longer passes the motion snapshot to the workspace session (`compose/studio-startup.ts`; one capture line removed). `parseWorkspace` reads the legacy idle and pose with the node's validators (`validIdleClip`, `storedPoseOf`).
- **Reduced:**
  - `MotionActions`' `initial`, `blink`, `blinkPlaying`, `clip` and `pending` fields;
  - its physics refusal for a service with no scene;
  - the composer's motion overlay and its idle and pose rules.

**How existing workspaces migrate.** The main view's scene node takes its motion from the workspace's legacy `preview` fields once, whenever it holds none (`workspaceViewGraph`):

- A workspace the profiles migration hasn't run on yet, or ran on before this chunk, has scene nodes without motion. Its main scene takes the legacy fields' motion when the graph is built.
- The window's next save writes the session with the motion in the node. From then on the node wins, and the legacy fields are never read for motion again.
- A session made by the profiles migration from now on takes the motion when it is made (`sessionOfWorkspace`).
- Other scenes without motion start at the default motion.
- The legacy fields stay as they were at the upgrade (profiles design §2.4's rule for legacy fields), so a build before this chunk opens the motion as it was then. That build's scene codec drops the node's `motion` when it saves and writes its own motion into the legacy fields, so this build reads that motion again. This is the documented reset on downgrade, and the round trip loses nothing the older build showed.
- A window whose session isn't stored yet (the migration hasn't finished) keeps motion changes for the page only. The tab arrangement already works this way.

**Gates.**

- **T1** (`tests/scene-motion.test.ts`, 11 tests):
  - an upgraded workspace's motion comes through unchanged (read once, then only the node is written, and the node wins on the next read);
  - a workspace round-trips byte-identically when nothing changed; an upgraded one gains only its main scene's `motion`, once;
  - an older-build reader: the scene codec at `d9f88a33` reads every stored scene node, the legacy fields hold the upgrade's motion, and the downgrade round trip reads the older build's motion again;
  - the codec validates and normalises, and refuses a damaged motion;
  - motion records no step, and Undo and Redo of eye shape and hair physics leave it as it is now (fails with `keepUnrecorded` removed);
  - a new head of the same scene restores the node's motion from the phase the previous head left, whatever the workspace snapshot says;
  - a device's fallbacks are stored as restore-time state that records nothing;
  - after review: a damaged closure in a second scene (and a damaged switch beside it) keeps both views and recovers only that field, and so does the legacy `views` field; a released service's late idle load failure leaves the replacement's choice, and a pose still loading on it never plays; a save reads the playing idle's phase (7.25 s, not the 3.5 s of the last change) without recording, publishing or touching the legacy fields. The recovery and release tests fail with their fixes taken out.
- **Restore order:** `tests/trusted-preview-services.test.ts` and `tests/preview-service.test.ts` are unchanged and pass.
- **History parity:** `tests/golden/history-parity.json` is unchanged. The View and lighting session's data digest now leaves out the scenes' `motion` (`tests/fixtures/history-parity.ts`), and every step, label, event and Undo or Redo state matches.
- **Tests that built `MotionActions` from a `preview` block** now pass the motion to a scene. The composer and idle-choice persistence tests now check the node and the session.

**Results** (22 October 2026; under the 3 GB guard):

| Run | Result |
|---|---|
| Motion, idle, pose, blink, view-graph, history, parity, workspace, profiles, boundary, lighting, preview-service and scene tests, and every other test file importing a changed module (after the review fixes) | 114 files, 1,115 pass, 0 fail (peak 1.6 GB) |
| `tests/scene-motion.test.ts` | 11 of 11 pass |
| WebGL probes whose tests touch motion | scene host 7 of 7, renderer device 7 of 7 (peaks 1.1 and 1.2 GB) |
| WebGL disposal gate (its page plays the idle) | 4 of 4 pass (peak 1.1 GB; the first attempt was stopped by the guard's free-memory floor while the game ran, and passed once memory recovered) |
| `bun run check` | passes |

**Decisions and caveats.**

- **The legacy fields are frozen, not mirrored.** The plan's row said the mirror stays. The brief said to write only the new place, and profiles design §2.4 freezes legacy fields, so they are written back as read.
- **The idle's phase while it plays.** The node holds the phase of the last motion change, head release or save (`sample`), so a page reload resumes a playing idle where it was when the page last saved, as before the move.
- **Fallbacks are stored, as before.** A head that can't play the idle stores it off, and a missing idle choice falls back to the default. This matches what the workspace used to save, so behaviour is unchanged. Under 4a-iv's residency, though, a masculine runtime (idle `IDLE_MASCULINE`) would write the idle off into a scene a feminine runtime shares. Whether the node should keep the person's choice while a device can't play it is a 4a-iv decision.
- **Layout fragments carry the motion.** `layoutFragment` copies node state, so a default made from a scene now holds its whole motion (phase, blink, pose), not only the idle choice that design §4.2 names. Phase 2 may trim it.
- **`storedViewGraph` and `isDefaultViewGraph`** have written nothing in production since phase 1 froze `views`. Their rule ("the default graph's state is the mirrored `preview`") no longer covers motion. They are candidates for removal.

**What 4a-iv needs from this.**

- **A new runtime reads motion from the graph.** `headWorkspace` no longer carries motion, so dropping the snapshot loses no motion. It still carries the live camera pose (an orbit doesn't write the camera node, §8), so the camera's write-on-hide comes first.
- **Apply on show, not on build.** A runtime built hidden while another shows should apply the scene's motion when it is shown: release the shown runtime's motion (`release()`, which stores its phase), then `restore()` the new one. With one runtime, build and show are the same moment.
- **One motion service per runtime, over the same node.** `graphMotionScene` takes the view whose scene the runtime draws, so runtimes of one scene share the node. The decision on stored fallbacks (above) belongs with residency.
