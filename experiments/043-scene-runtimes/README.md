# Experiment 043: scene runtimes (profiles phase 4a)

**Status:** gap map and chunk plan, 22 October 2026. **Planning only:** no production code has changed. The coordinator approves the plan before chunk 4a-i starts. This is the working record for [profiles design §4.5](../../research/authoring/profiles-views-layouts-design.md#45-scene-runtimes-and-switching-phase-4a) and its phase 4a row in §9.2. It builds on spike S2 ([experiment 039](../039-view-switch-spike/README.md), prototype on branch `claude/spike-views`).

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
| **4a-iii: Motion settings into the scene node** | Idle, clip, pause, contributions, blink and pose become scene-node state in the graph, with View and lighting history as today. `MotionActions` reads and edits the node. The legacy `preview` mirror stays for older builds. | T1: workspace fixtures round-trip byte-identical when nothing changed; an older-build reader test; restore order unchanged. | 0.75–1 | — (alongside 4a-ii) |
| **4a-iv: Residency and the superseding subject change** | A DOM-free residency owner: per scene, a wanted (subject, body); runtimes moving through building, preparing, ready, shown, warm and disposed; N warm (default 1, tunable); least recently shown evicted first; supersession by `AbortController`, with a generation check so no late result is shown. The character context outlives runtimes, and its scene ports follow the shown runtime (`CharacterService.detach` goes). Warm runtimes stop following and catch up on show. **`reloadHead`, `headWorkspace` and the `not_ready` refusal are removed.** `PreviewSetupActions` keeps only first-run setup. `ensureBody` takes a signal. | T1 (model-based, seeded): random body and V changes with cancels, where the last choice is always shown, nothing superseded is shown, cancel is ≤ 100 ms on the injected clock, the warm runtime is reused, and eviction and close dispose. T2: female, male, then female 150 ms later shows female; closing a subject returns GL counts. | 2 | 4a-ii, 4a-iii |
| **4a-v: Prepare before switching, with progress** | `runtime.prepare(view, signal)`: async compile of the whole scene for each lighting setup its views show (main, scatter, contact and shadow variants), core and detail textures uploaded a few per frame, then one hidden warm-up draw into a small offscreen target. A typed preparation state. The head pane keeps the previous V drawn and shows progress in its existing quiet overlay (`studio-ui/panels/viewports.ts:111–115`), with no new component expected. `device.show(view)` with the same rule, for phase 2's tabs. | T2: warm switch ≤ 100 ms to the first presented frame; no main-thread task over 50 ms from the request to 1 s after the switch; programs and uploads during the shown frame are 0. G2: the same on real data with a fresh Chrome profile (cold program cache). UI review PASS. | 1.5–2 | 4a-ii (the API); 4a-iv (wiring) |
| **4a-vi: Routing by named view, exception 17, gates and records** | View actions routed to the named view's runtime, with the `NOT_DRAWN` refusals, `drawsScene` and the `MAIN_VIEW` seeds removed. Editors bound per view (`preview/browser/scene-editors.ts`). Loaders through `character.setSource` with readiness per scene. Exception 17 removed. `tests/webgl-scene-runtimes.test.ts` (T2), and `measure.ts` in this folder (T3). Records: design §4.5 "Built in phase 4a", view graph status, boundary record, action catalogue, and a knowledge page on program linking and residency in WebGL. | T1 in CI. T2 and T3 as release oracles. The no-default boundary test and the view-graph ratchet updated (the scene-host importer list shrinks). G3: the full S2 gate table, on real data. | 1.5–2 | 4a-iv, 4a-v |
| **Total** | | | **8.75–11** | |

**Against the design's 7–9.** The estimate is higher for two reasons. First, the motion settings move into the scene node (4a-iii). That is what lets `reloadHead`'s workspace snapshot go rather than live on, and the design's estimate didn't include it. Second, the leak audit found that disposal depended on context loss throughout, not in one place. 4a-iii can run alongside 4a-ii, and 4a-v's runtime half alongside 4a-iv, so with two agents the elapsed time is about three quarters of the total.

**Reductions as the work migrates:** `reloadHead` and its refusal, `headWorkspace`, `CharacterService.detach`, the root's head variables and `attachHead`/`releaseHead`, `NOT_DRAWN`, `DRAWN_CHECKS` and `drawsScene`, the `MAIN_VIEW` seeds in `trusted-preview-services.ts`, and exception 17.

## 4. Decisions

Each decision has a proposed default; the coordinator can change it.

| # | Question | Proposed default |
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
