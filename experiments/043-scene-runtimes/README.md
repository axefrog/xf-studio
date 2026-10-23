# Experiment 043: scene runtimes (profiles phase 4a)

**Status:** gap map and chunk plan, approved 22 October 2026 with decisions D1–D4 at their defaults (§4). Chunks 4a-i (§7), 4a-ii (§8), 4a-iii (§9), 4a-iv (§10), 4a-v with its G2 follow-ups 4a-v-b (§11) and 4a-v-c (§12), and 4a-vi (§13) are built on `claude/profiles-4a`; G3 and the merge are next. This is the working record for [profiles design §4.5](../../research/authoring/profiles-views-layouts-design.md#45-scene-runtimes-and-switching-phase-4a) and its phase 4a row in §9.2. It builds on spike S2 ([experiment 039](../039-view-switch-spike/README.md), prototype on branch `claude/spike-views`).

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
| **Risks** | *Renderer-global state* (§2.7). *Shared DOM host:* each host observes `headHost` itself (`:281`); the device must own that. *Context loss* now costs every resident runtime its GPU state: the device evicts the warm ones and restores only the shown one. *Frame-sized targets are per runtime:* the scene-linear target (`preview/render/linear-display.ts:155`), the skin scatter's three targets (`platform/scene/skin-scatter.ts:166–171`) and the contact-shadow target (`platform/scene/contact-shadow.ts:60`) would be duplicated in a warm runtime. A hidden runtime releases them, and showing it allocates them again before its first frame (allocation only, no compiles; §15). |

### 2.2 Hidden creation with an `AbortSignal`

| | |
|---|---|
| **On main** | Only the V's details take a signal (`character/character-detail-actions.ts:109`, `:158–205`). Optional renderers register with one (`feature-renderers.ts:211–214`). A failed build releases what it made (`scene-host.ts:69–79`). |
| **Missing** | A signal through `createSceneHost`, `loadCoreDetail` (fetch and its steps, `character/render/core-detail-loader.ts:58–103`), `createHeadRig` and its motion load (`platform/scene/head-rig.ts`), feature renderer creation, and `PreviewPreparationActions.ensureBody` (`preview/preview-preparation.ts:152`, which has no signal and polls up to 2,000 times). A built runtime that has no path to the canvas: the S2 prototype drew 2 stray frames because each host had its own scheduler. |
| **Risks** | *Cancel latency:* `GLTFLoader.parseAsync` and texture decode can't be stopped part-way, so abort is checked between steps, and one step (a whole-body glTF parse) may itself be a long task. The cancel gate (≤ 100 ms) is measured from abort to the last upload, as S2 measured it. *Host preparation:* when a body change is superseded, does the masculine core's host preparation (18.5 s cold) stop, or finish as a cache? See decision D1 (it finishes). |

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
| D1 | When a masculine body change is superseded, does the host's core preparation (18.5 s cold, one-time) stop? | **Revised 23 October: it runs to completion.** A page's abort stops only that page's wait (its poll and its `ensureBody` promise); it never cancels the host job, which every page that asks joins (one job per body). The first answer (it stops once nothing wants it) needed cross-window liveness leases, and two review rounds showed why that doesn't hold: a lease can't tell a throttled background tab from a dead one, so any timeout either cancels a live page's job or keeps a dead page's. The job is one-time and its result is cached and reused, so it is worth finishing. Cancel on the setup card still stops it. |
| D2 | Is the residency budget a count, or bytes too? | A count (N = 1), plus: warm runtimes are dropped first on context loss or a failed allocation, and each runtime's estimated bytes are published as evidence. A byte cap waits for G3's measurements. |
| D3 | Camera per runtime or per view in 4a? | Per runtime, attached only while drawn, with the pose kept in the camera node. View runtimes (several cameras over one scene) come in 4b. |
| D4 | Workspace takeover in place (design §2.3)? | Not in 4a; a follow-up. |

## 5. GPU runs the coordinator schedules

None ran in this planning pass. Memory figures are guard limits. Durations include the server's start on a warm preview cache.

| Run | When | What | Memory | Duration |
|---|---|---|---|---|
| **T2 probes** (synthetic heads, no game files) | Every chunk from 4a-i, during development | `bun test tests/webgl-scene-host.test.ts tests/webgl-scene-runtimes.test.ts` under the guard | Expected under 1.5 GB (bun plus one headless Chrome, small synthetic textures). Confirm on the first run with `--limit 3`; ask for 4 if it is killed. | 1–3 min each |
| **G1: scene parity** | End of 4a-ii | `tools/scene-parity.ts` against main: 20 frames, both lighting presets, 1K and 2K, real V, isolated server (039's environment variables, its own port, scratch caches) | Server `--limit 3` (S2 peaked at 1.8 GB), Chrome `--limit 4`. About 7 GB together. | 10–15 min |
| **G2: first draw on a cold program cache** | End of 4a-v | `measure.ts` in this folder (run 23 October 2026, §11), switch part only, with a fresh Chrome profile: a lighting setup and a body never drawn before, with long tasks, links and uploads (`gl-probe.ts`) | Server 3, Chrome 4 (head only). About 7 GB. | 10–15 min (the cold link alone was 94 s in S2) |
| **G3: the full S2 gate table** | End of 4a-vi, before merge | `measure.ts` in this folder: views, subjects, residency and memory, on real data, warm cache and then a fresh profile. **Whole-body part:** two whole-body Vs resident in one page. | Head-only parts: server 3, Chrome 4. **Whole-body part: Chrome 6** (S2's run 3 was killed at 4.1 GB under 4). Up to about 9 GB together, more than the free margin above the 16 GB floor, so other chats' memory has to be lowered for its window. | 20–30 min |

Each real-data run uses an isolated server and scratch caches, as S2 did: never port 4317 or 4331, never the maintainer's library or workspace. G1–G3 need the masculine core prepared once (18.5 s cold).

## 6. Open risks, ranked

1. **Variants built at draw time** (shadow depth, ANGLE input layouts) defeat compile-ahead. Answered by G2: the hidden warm-up draw readies Three's own variants, and ANGLE's (several outputs, integer vertex inputs) are removed at their source (§12).
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
- **The root's head variables went.** 4a-ii read the saved-V, preview and motion services from one `head` variable (`savedAppearance`, `previewActions` and `motionActions` went then); 4a-iv removed `head`, `scene`, `attachHead`, `releaseHead` and `headWorkspace` too, for the scene runtime owner (§10).
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

**Results** (22 and 23 October 2026; RTX 4070, ANGLE D3D11, headless Chrome; every run under the 3 GB guard, peaks 0.5–1.4 GB):

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

**G1, scene parity on a real V** (run 22 October 2026 on `d9f88a33`, against `72369156`). It compares this branch with `main` at the merge base, using `tools/scene-parity.ts` on an isolated server as S2 ran it: never port 4317 or 4331, never the maintainer's library or workspace.

1. In a checkout of the base, and then in this worktree, start an isolated server on its own port with scratch caches (039's environment variables), under `memory_guard.py --limit 3`.
2. On the base, run `bun tools/scene-parity.ts capture <evidence/screenshots/043-g1/base-1> <port>` twice (`base-1`, `base-2`: the first creator frame can differ between runs of one build). On this branch, run `capture <…/after> <port>`. Chrome runs under `--limit 4`.
3. Run `bun tools/scene-parity.ts compare <…/after> <…/base-1> <…/base-2>`. Every frame (five looks, both lighting presets, 1K and 2K: 20 frames) must match one base capture within the noise rule below. The outputs are private renders; keep them in the ignored `evidence/screenshots` tree.

**G1 results.**

| Item | Value |
|---|---|
| GPU | RTX 4070, ANGLE D3D11, headless Chrome |
| Frames | 17 of 20 byte-identical to a base capture. 3 differ from both bases by one channel step (1/255) on 1, 3 and 8 pixels, all in the 584 × 788 crop and mostly near the face (x 378–437, y 476–515) |
| Same-build noise | `base-1` and `base-2` themselves differ by 1 pixel, one step (`board3-creator-2048`) |
| Peak memory | Chrome and capture 3.9–4.0 GB against the 4 GB limit (G2 and G3 give Chrome 5 GB) |
| Duration | 160–213 s per capture, plus waits for memory |

**The parity rule, revised.** "Byte-identical to one base" assumed the GPU path is deterministic, and two captures of one build show that it isn't. A frame now passes when it differs from a base by at most one channel step on fewer than 0.01 % of its pixels (the worst G1 frame is about 0.002 %). G1 passes under that rule. G3 rechecks it before the merge.

**What 4a-iii and 4a-iv needed from this** (each built: motion in §9, the rest in §10).

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
- **A damaged optional scene setting never costs the graph.** The scene codec still refuses invalid values on an edit. On read, `recoverScenes` (`preview/preview-view-graph.ts`) recovers each character scene's optional settings first: each damaged motion field goes back to its default (`recoverSceneMotion`), a damaged idle choice or pose is left out, a motion that isn't an object is left out, and a damaged optional switch (`eyeOwnRoughness`, `uncensored`, `physics`) is left out. Before this, one out-of-range closure in a second scene rejected that scene, the graph fell back to the default one-view graph, and the next save made the loss permanent. Both the session's graph (`workspaceViewGraph`) and the legacy `views` field (`parseWorkspace`) read this way. An unreadable value can't be honoured, so it isn't kept, but the restore says what it reset: `parseWorkspace` recovers each stored session's scenes and adds one plain line per damaged scene to the restore warnings, in the person's names for the settings ("Some 3D view settings couldn't be read and were reset: hair physics, blink."). The legacy `views` field is reported only while no session exists, since only then is it what the Studio shows. The line reaches the notice the workspace already shows for a repaired restore (`loadWorkspace().warning`, save status `repaired`); several lines are joined after any dropped-draft note.
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

- **T1** (`tests/scene-motion.test.ts`, 12 tests):
  - an upgraded workspace's motion comes through unchanged (read once, then only the node is written, and the node wins on the next read);
  - a workspace round-trips byte-identically when nothing changed; an upgraded one gains only its main scene's `motion`, once;
  - an older-build reader: the scene codec at `d9f88a33` reads every stored scene node, the legacy fields hold the upgrade's motion, and the downgrade round trip reads the older build's motion again;
  - the codec validates and normalises, and refuses a damaged motion;
  - motion records no step, and Undo and Redo of eye shape and hair physics leave it as it is now (fails with `keepUnrecorded` removed);
  - a new head of the same scene restores the node's motion from the phase the previous head left, whatever the workspace snapshot says;
  - a device's fallbacks are stored as restore-time state that records nothing;
  - after review: a damaged closure in a second scene (and a damaged switch beside it) keeps both views and recovers only that field, and so does the legacy `views` field; a released service's late idle load failure leaves the replacement's choice, and a pose still loading on it never plays; a save reads the playing idle's phase (7.25 s, not the 3.5 s of the last change) without recording, publishing or touching the legacy fields. The recovery and release tests fail with their fixes taken out.
  - after the second review: Sol's reproduction in a second scene (damaged eye roughness, uncensored and hair physics switches beside a damaged closure) gives one restore line naming those settings in the person's words, the session keeps the recovered scene and both views, a whole motion that isn't one names every motion setting, an undamaged workspace says nothing, and `loadWorkspace` carries the lines in its restore notice.
- **Restore order:** `tests/trusted-preview-services.test.ts` and `tests/preview-service.test.ts` are unchanged and pass.
- **History parity:** `tests/golden/history-parity.json` is unchanged. The View and lighting session's data digest now leaves out the scenes' `motion` (`tests/fixtures/history-parity.ts`), and every step, label, event and Undo or Redo state matches.
- **Tests that built `MotionActions` from a `preview` block** now pass the motion to a scene. The composer and idle-choice persistence tests now check the node and the session.

**Results** (22 October 2026; under the 3 GB guard):

| Run | Result |
|---|---|
| Motion, idle, pose, blink, view-graph, history, parity, workspace, profiles, boundary, lighting, preview-service and scene tests, and every other test file importing a changed module (after the review fixes) | 114 files, 1,116 pass, 0 fail (peak 1.5 GB) |
| `tests/scene-motion.test.ts` | 12 of 12 pass |
| WebGL probes whose tests touch motion | scene host 7 of 7, renderer device 7 of 7 (peaks 1.1 and 1.2 GB) |
| WebGL disposal gate (its page plays the idle) | 4 of 4 pass (peak 1.1 GB; the first attempt was stopped by the guard's free-memory floor while the game ran, and passed once memory recovered) |
| `bun run check` | passes |

**Decisions and caveats.**

- **The legacy fields are frozen, not mirrored.** The plan's row said the mirror stays. The brief said to write only the new place, and profiles design §2.4 freezes legacy fields, so they are written back as read.
- **The idle's phase while it plays.** The node holds the phase of the last motion change, head release or save (`sample`), so a page reload resumes a playing idle where it was when the page last saved, as before the move.
- **Fallbacks were stored in this chunk.** A head that couldn't play the idle stored it off, and a missing idle choice fell back to the default, as the workspace used to save it. 4a-iv reversed this by the coordinator's decision: the node keeps the person's choice (§10).
- **Layout fragments carry the motion.** `layoutFragment` copies node state, so a default made from a scene now holds its whole motion (phase, blink, pose), not only the idle choice that design §4.2 names. Phase 2 may trim it.
- **`storedViewGraph` and `isDefaultViewGraph`** have written nothing in production since phase 1 froze `views`. Their rule ("the default graph's state is the mirrored `preview`") no longer covers motion. They are candidates for removal.

**What 4a-iv needed from this** (built in §10).

- **A new runtime reads motion from the graph.** `headWorkspace` no longer carries motion, so dropping the snapshot loses no motion. It still carries the live camera pose (an orbit doesn't write the camera node, §8), so the camera's write-on-hide comes first.
- **Apply on show, not on build.** A runtime built hidden while another shows should apply the scene's motion when it is shown: release the shown runtime's motion (`release()`, which stores its phase), then `restore()` the new one. With one runtime, build and show are the same moment.
- **One motion service per runtime, over the same node.** `graphMotionScene` takes the view whose scene the runtime draws, so runtimes of one scene share the node. The decision on stored fallbacks (above) belongs with residency.

## 10. Chunk 4a-iv: residency and the superseding subject change (built)

Sol's review answered MERGE AFTER FIXES, with six Medium findings and one Low. All seven are fixed at the root and described below as current truth:

- preparation leases;
- the abort reaching the transport;
- preview workers bounded by residency;
- the stale idle load stopped in the device;
- the warm clip reconciled;
- the warm pose let go;
- the eye-shape status.

Sol's confirmation found five fixed and two only partly fixed, with one new Medium finding in each. A lease could outlive its page, and a suspended preview device lost its live turn while a non-resident V could make a device outside the budget. Both were fixed. The next confirmation found the suspension fix holding, and three new Medium findings: the lease timeout could cancel a throttled live page, a disposed page's next poll could take its lease back, and a question waiting for suspension could outlive its requester or its live turn (leaving a preview stage busy for good). The coordinator then revised decision D1 (§4): the host's preparation runs to completion, so the lease machinery is gone and the first two findings with it. The third is fixed at the root. Each fix has its regression test.

**What changed.**

- **Residency is one DOM-free owner** (`preview/scene-residency.ts`, `SceneResidency`). The drawn scene wants one runtime, named by its (scene, subject, body) key. Phase 4a draws one view, so the drawn scene's want is the only one; with several drawn views (4b) wants become per view.
  - **The newest want wins.** A build in flight for an older want is aborted through its `AbortController`. Whatever it still produces is disposed and never shown: a generation check compares the finished build with the one wanted now.
  - **The previous runtime stays shown** until the wanted one is built. The swap is one step: the shown runtime is hidden first, so it can hand over its camera and motion, then the new one is shown.
  - **The budget is a count** (decision D2): the shown runtime plus `warm` others, 1 by default and set at construction. A runtime that stops being shown becomes warm. Past the budget, the least recently shown is disposed. Wanting a warm runtime again shows it at once, with no build.
  - **A lost context drops the warm runtimes first** (`contextLost`). The shown one, and one still being built, are restored by the device as in 4a-ii.
  - **Disposal is ordinary disposal** through the port, the same for eviction, context loss, a superseded build, `close(scene)` and `dispose()`. 4a-i's gate holds.
  - A runtime that can't be shown goes, and the one shown before is shown again.
- **The window's scene runtime owner** (`preview/browser/browser-scene-heads.ts`, `createBrowserSceneHeads`). It owns the residency and wants a head for the drawn scene's V and that V's body.
  - **A subject or body change is a new want.** It follows the session's scenes (the scene's V) and the V's context (its body: a save, a preset, the other Default V, Undo), once the change that asked for it has finished (a microtask).
  - **Nothing is refused meanwhile.** The V's context stays attached while heads swap, so a creator change during a body switch lands at once. The old `not_ready` refusal ("The creator options are still loading.") came from the context being detached for the reload, and is gone.
  - **The V's context outlives heads.** The character's owner makes it once per V. Its scene ports are bound late: `showSave`, `details` and the previews reach the head showing that V now, and do nothing while none does. A save of the other body is shown only on a head of its body; the new head is built with it and catches up on show. `CharacterService.detach` is gone, and contexts live for the page.
  - **The budget bounds preview workers too, as one decision with the heads.** Each V's choice-preview device (a worker with its own WebGL context) exists only while the owner *admits* the V and a question wants it (`character/choice-preview-suspension.ts`). The owner admits exactly the Vs a resident head shows, so devices never outnumber the residency budget. Whenever the residents change, admission is withdrawn first and then granted, so a V admitted now never makes its device while one past the budget still lives.
    - **A V that isn't admitted makes no device.** Its context, choices and history stay. A question its requesters ask meanwhile (a lookup, a drawing, a frame) waits, and runs on a new device once a resident head shows the V again.
    - **Every wait has a lifetime.** Each requester's lease of the device (`ChoicePreviewOwner`) passes its own lifetime with every question, so a question still waiting is refused and let go when its requester is disposed. A live question also waits within its turn: a newer start or `stop` ends the turn and refuses its waiting frames. The context's disposal ends every wait.
    - **The preview stage is never left busy.** The stage asks one live frame at a time; a frame source replaced or stopped makes the request under way nobody's, so the new source is asked at once (`studio-ui/components/choice-preview.ts`).
    - **A new device is given back what the old one held** before it answers anything: the subject head, then the live turn's source. A question whose device was ended under it is asked again of the next device. So a suspension fails no work, and a live turn the preview service still holds keeps drawing (the reviewed failure: every later frame was `null`).
  - **`load()` is the preview setup's first load** and its Try again. It resolves once a head of the drawn scene is shown. A want superseded during the first load waits for the one that replaced it.
  - **A later head that can't be built leaves the V shown before**, with one plain notice ("Your V couldn't be shown in the 3D view, so the V shown before stays. Change the V again to try once more.") and a diagnostics entry. The next change builds again.
  - **Core preparation progress** goes to the head pane: its loading state while nothing is shown, its quiet status line while another V is (4a-v replaced this chunk's one-off notice, §11).
- **A head is built, shown and hidden** (`preview/browser/browser-head-attachment.ts`, `buildBrowserHead`).
  - *Built hidden, with the signal:* the body's core prepared, the scene built on the device, the stage theme, research tools and quality followers, the V's detail service, and the saved-V, preview and motion services. Nothing reaches the application.
  - *Shown:* drawn on the device, its services attached, its layered surfaces connected and the on-head editor mounted, its save caught up with the V's, the scene's motion restored and the view's camera read. It follows the V's context (details, facial shape, makeup, body switch, puppet).
  - *Hidden:* the camera pose goes to the view's camera node, the motion is released, then everything `show` connected is let go, newest first. The on-head editor goes with it. Detaching settles any open gesture (it is cancelled), and the next head shown mounts its own editor. A hidden head is warm: it stops following its V and catches up when shown again.
- **The camera pose round-trips through hide and show** (decision D3's second half). `PreviewActions.storeCamera` writes the device's pose to the drawn view's camera node, unrecorded. `storedCamera` reads it back, and the next head shown restores it without a step or a trail entry. An orbit still writes nothing while it moves.
- **Motion is released on hide and restored on show** (`MotionActions`). `release` stores the playing idle's phase and stops anything under way from reaching the device or the scene. `restore` takes the service back and applies the node's motion:
  - **The clip is reconciled every time.** The service knows which idle the device plays; when that isn't the scene's idle, the scene's is loaded, the default included.
  - **A pose the scene no longer holds is let go first**, judged by what the device plays. The rig then plays its own idle again, and the scene's idle follows once it has.
  - **A load carries an `AbortSignal` into the device** (`MotionPort.selectIdle(id, signal)`, the scene runtime's `selectIdle` and the rig's in `platform/scene/head-rig.ts`). A newer load or a release aborts it, and the rig checks the signal after loading and before it changes clips, so a stale load never changes what plays, even when it succeeds. An epoch also keeps its bookkeeping out.
  - `createTrustedPreviewServices(...).finish()` builds without applying motion or camera; its `show` applies the motion, then the camera, and its `hide` stores the camera, then releases the motion.
- **Intent stays in the node** (the coordinator's decision). The scene node keeps the person's choice when a runtime can't honour it. The runtime shows its fallback as status and writes nothing:
  - **Motion.** The idle on a masculine head (`IDLE_MASCULINE`), an idle not prepared on this computer, or one whose clip failed to load (kept per device as unplayable): the device plays its own fallback, and `snapshot` shows it (idle off, the close-up, eyes open on a device without the blink). Only the person's own changes and the playing idle's phase are stored. A blink change on a head that can't play the idle stores the idle off too, because the person chose it on what they see.
  - **Eye shape.** A head lacking the chosen eye shape shows its base shape; the scene node keeps the choice (and the legacy mirror with it). `PreviewActions.eyeShapeOptions()` says what the head shows (`shown`) and why (`fallback`, a plain line). A shape another runtime chooses that this head lacks is also shown as its base shape. The Character panel selects the shape shown and puts the line in its eye-shape note.
  - The display's restore-time fallback for brows and lashes stays: it is per view, and no browser host reports it.
- **`ensureBody` takes the signal, and an abort stops only the page's wait** (decision D1, revised). An abort cuts off a Refresh or Prepare in flight (the transport and `fetch` carry the signal), stops polling and rejects with the signal's reason. The host's preparation goes on: one job per body, which every page that asks joins, run to completion and cached for the next request. Only Cancel on the setup card stops it. `PreviewPreparationActions.dispose` aborts every call still waiting and stops polling, so nothing is left asking.
- **The viewport device holds several heads.** `buildHead(body, signal)`, `showHead`, `hideHead` and `disposeHead` replace `loadHead` and `unloadHead`. `onContext` lets the runtime owner hear a lost context.
- **The composition root keeps only wiring.** `head`, `scene`, `headWorkspace`, `attachHead` and `releaseHead` are gone. The root makes the scene runtime owner with its ports, connects the shown head's followers (the live face, the poses stage, prefetching, readiness) in one `shown` hook, and reads the shown head through `heads.shown()`. The developer evidence (`xfStudioSceneEvidence`) adds `residency`.

**Removed.**

- `PreviewSetupActions.reloadHead`, the root's `headWorkspace` snapshot and its reload path, and the `not_ready` refusal during a reload.
- `attachHead`, `releaseHead`, `head` and `scene` in `compose/studio-startup.ts`; `attachBrowserHead` (now `buildBrowserHead` with `show`, `hide` and `dispose`).
- `CharacterService.detach`.
- The viewport device's `loadHead` and `unloadHead`.
- The motion's and eye shape's restore-time fallbacks written into the scene node (`MotionScene.setMotion`'s `seed` option).
- `storedViewGraph` and `isDefaultViewGraph`. A legacy `views` field that reads is now kept and written back as read, the default graph included, since the field has been frozen since phase 1. Their tests now use `sessionViewGraph`, or were dropped where they only tested the dead rule.

**Gates.**

- **T1, residency** (`tests/scene-residency.test.ts`, an injected clock, builds in steps that check their signal):
  - female, male, then female 150 ms later shows female, and the male build stops at its next step (≤ 100 ms of clock);
  - the previous runtime stays shown until the new one is built, and a superseded want's runtime is never shown;
  - a build finishing after it was superseded is disposed (the generation check; fails with it taken out);
  - a warm runtime is reused without a build, the least recently shown is evicted past the budget (fails with the order reversed), and closing disposes everything;
  - a context loss drops the warm runtimes first; a zero budget keeps only the shown one;
  - a failed build leaves the previous runtime shown; a runtime that can't be shown goes, and the previous one is shown again;
  - five seeded model runs of 60 random subject and body changes each. After each step there is at most one shown and one warm runtime. At the end the last choice is shown, every want was shown or superseded, every cancel took ≤ 100 ms, a warm want was shown with no build, and every runtime built was disposed exactly once.
- **The scene runtime owner** (`tests/browser-scene-heads.test.ts`, the real head attachment and viewport device over fake scenes):
  - a superseding body switch shows the last choice: the female V stays drawn while the male head is wanted, the context stays attached, and back to female the male core's preparation is aborted;
  - the new head is built hidden and the old one stays drawn until it is ready; the old one stays warm and comes back at once (also by Undo); a lost context drops it first;
  - no late result is shown;
  - each V's context is made once, its ports reach the head showing it, and do nothing while none does;
  - the first load waits for the head that superseded it; a failed first load rejects with nothing shown;
  - a later head that can't be built leaves the V shown before, with the notice.
- **The head attachment** (`tests/browser-head-attachment.test.ts`):
  - built hidden, a head reaches neither the application nor the canvas;
  - a failed show releases what it connected;
  - surfaces connect on show and go on hide;
  - an aborted masculine preparation rejects with the abort rather than falling back to the feminine head;
  - **the camera pose round-trips through hide and show.**
- **Motion on a warm rig** (`tests/scene-motion.test.ts`, a device over the real `IdleAnimation` that loads as the rig does; each fails on the code before the review fixes):
  - an idle load that *succeeds* after its runtime was hidden and shown again never replaces the clip the scene now plays;
  - a warm runtime shown again plays the scene's idle when that is the default (Inventory, then Close-up chosen on the other runtime);
  - a pose the other runtime let go is let go on the warm rig, which then plays the scene's idle.
- **Preview workers** (`tests/browser-scene-heads.test.ts`, `tests/choice-preview.test.ts`):
  - four Vs with previews open leave only the two resident Vs' devices alive. Requesters of the two non-resident Vs keep asking: no device is made and their questions wait, a waiting lookup ends at once when its signal aborts, and the first V's question runs once its head is shown again, with still only two devices alive;
  - Sol's sequence: A's live turn, then B, then C, which evicts A, then back to A. A's next frame makes a new device, which gets the subject head and the live source before it draws;
  - the same over the real `ChoicePreviewService` and `ChoicePreviewOwner`: nothing is made before the V is admitted, and after a suspension the service's ready live turn draws on the new device with no failure counted;
  - a requester disposed while its questions wait for a V that never returns: all three are refused and none is left waiting. A frame waiting for a live turn is refused when the turn stops, and when a newer start replaces it. No device is ever made;
  - the preview stage (light DOM): a frame left waiting by a stopped turn doesn't hold up the next turn's first frame (fails on the stage before the fix).
- **Motion** (`tests/scene-motion.test.ts`):
  - **a runtime that can't honour the node's motion leaves the node unchanged** (a masculine head with the idle on, a clip and a phase; a device without the blink or a catalogue). It shows its fallback, and the feminine head shown next plays the chosen idle from the stored phase;
  - **motion is released and restored across a swap:** a warm head shown again plays from the phase the other head left, and its load from before it was hidden failing later changes nothing.
- **D1** (`tests/masculine-core.test.ts`):
  - two windows on a real host through its endpoint wait for one masculine preparation, asked for once. Both are superseded: each stops waiting at once, and the job runs to its own end, never cancelled (on the synthetic game files it ends blocked; with real files it ends ready and cached). No `cancel` is ever sent. This fails on the lease design, which cancelled it;
  - disposing the service ends two calls still waiting (neither with a signal of its own) in under 200 ms, nothing polls afterwards, and a call after disposal asks nothing;
  - an abort cuts off a held Refresh and a held Prepare in under 200 ms, and nothing more is asked.
- **Eye shape** (`tests/trusted-preview-services.test.ts`): a head lacking the scene's eye shape shows its base shape and leaves the node's choice; its status reports the shape shown and the reason; a missing shape chosen elsewhere is shown as the base shape. Restore order is unchanged: saved V, optics, eye shape and details when built; motion, then camera, when shown.
- **T2, the renderer device probe** (`tests/webgl-renderer-device.test.ts`, section 7 of its page): real runtimes on one counted context, under `SceneResidency`.
  - Female shown; male wanted, his core taking 600 ms; female again 150 ms later. Female stays shown, the male build rejects with `AbortError`, no male runtime is ever built, and the canvas is byte-identical.
  - Male is then built and shown, with female warm. A second feminine V evicts the least recently shown (female v1). Closing everything returns the GL objects and Three's programs to where they were.

**Results** (22 and 23 October 2026; RTX 4070, ANGLE D3D11, headless Chrome; every run under the 3 GB guard):

| Run | Result |
|---|---|
| T1 residency | 12 of 12 pass |
| Scene runtime owner, head attachment, motion, D1, eye shape (after the review fixes) | 7, 5, 16, 2 and 6 tests: all pass |
| Second round (23 October): scene runtime owner, choice previews, D1 | 8, 31 and 13 tests: all pass |
| Third round, after D1's revision (23 October): choice previews, D1, preparation and scene runtime owner | 33, then 28 tests across D1, preparation and the owner: all pass |
| T2 renderer device probe | 9 of 9 pass (peak 1.1 GB). Superseded build: `AbortError`, 0.2 ms from the superseding want to the build's rejection, canvas unchanged, only `s1\|v1\|female` built. Eviction: `s1\|v1\|female` evicted, `s1\|v1\|male` warm, `s1\|v2\|female` shown. After closing: 12 textures, 6 buffers, 6 framebuffers, 2 programs and 2 vertex arrays, as before the section, with only `BackgroundMaterial` used once. (The section runs after section 6's context loss, whose dead objects the counter still lists.) |
| WebGL scene host, disposal gate | 7 of 7, 4 of 4 (peaks 1.1 and 1.2 GB) |
| T2 and the WebGL scene host again, after both review rounds (23 October) | 9 of 9 and 7 of 7 (peaks 1.1 GB each) |
| T2 after the third round (23 October) | 9 of 9 (peak 1.1 GB) |
| Scene, view, preview, character, viewport, motion, history, parity, profiles, boundary, lighting, workspace and setup tests, and every other test file importing a changed module | After the review fixes, with the preview-core, choice-preview and desktop server tests added: 146 files, 1,419 pass, 10 skip (real-game oracles), 0 fail (peak 1.7 GB) |
| Second round, targeted: preparation, previews, residency, scene heads, character, creator, choices, profiles, motion, setup and boundary tests, every file importing the test head fixtures, the startup tests and the desktop server test | 72 files: 784 pass, 5 skip (real-game oracles), 0 fail (peak 1.3 GB) |
| Third round, the same targeted set | 70 files: 780 pass, 5 skip (real-game oracles), 0 fail (peak 1.5 GB) |
| `bun run check` | passes |

**Decisions and caveats.**

- **Ready meant built in this chunk.** The new head was shown once built, and its V's details filled in afterwards. 4a-v made ready mean prepared: details, programs and maps made ready while hidden, with progress (§11).
- **Preview demand waits for residency; it doesn't buy it.** A V's previews get a device only while a resident head shows it, and the device is made only once a question wants it. A non-resident V's questions wait rather than taking a warm V's device, because in 4a the Character panel shows only the shown head's V, so such questions are background work for a panel no one sees. With several drawn views (4b), a view's want makes its V resident, and its previews follow.
- **A warm V keeps its device**, as it keeps its head, so switching back is instant for previews too.
- **The preview stage's busy state** (`studio-ui/components/choice-preview.ts`) is a behaviour fix inside the component library: one frame request is tracked by a token that a new or stopped frame source clears. It changes nothing visible.
- **The Character panel's eye-shape note** gained the fallback line, and the selection follows the shape shown. This is a copy and wiring change in `studio-ui/panels/character.ts` with no new control, and it needs the UI review.
- **Contexts live for the page.** A V no scene shows keeps its context. Releasing one (`CharacterService.release`, after its changes are in the library) when no resident head shows it is a follow-up: an async release racing a switch back would hand the owner a disposed context.
- **The save loader's answer.** `savedAppearance.load` returns the shown head's saved-V snapshot. For a save of the other body that is the head shown before the switch, so its suggested eye shape is the old head's. This was already approximate before, when the old head applied the other body's save first.
- **No per-runtime byte estimate yet.** D2 asks for each runtime's estimated bytes as evidence. The snapshot carries the residents and their states; the bytes wait for G3's measurements and a port to report them.
- **No real-data run of 4a-iv yet.** G1 passed on 4a-ii (§8); G2 and G3 come with 4a-v and 4a-vi. A body switch on a real V, with the masculine core prepared, is the next in-browser check.

**What's left before merge.**

1. **The UI review for finding 7's panel change.** `studio-ui/panels/character.ts` selects the shape the head shows and adds a plain fallback line to the existing eye-shape note. It's a copy and wiring change with no new control.
2. **Sol's re-review** of the third round, then the coordinator's merge.

**What we learned.**

- **Rig changes need a cancellation token, not an epoch.** `selectIdle` loads its clips, then changes the rig itself before its promise settles, so ignoring a stale completion afterwards is too late. The signal has to be checked inside the adapter, after the load and before `setClips`.
- **A warm runtime needs the device's actual state, not only the scene's.** Reconciling against the default clip assumed the device was fresh. The service tracks what the device plays (`deviceClip`), and whether it still holds a pose (`posePlaying`).
- **Cancel only what is worth cancelling.** One page's abort must never cancel a host job another page shares. Leases scoped that correctly, but a lease needs liveness, and liveness can't tell a throttled background tab from a dead one: every timeout either cancels a live page's job or keeps a dead page's. A one-time job whose result is cached is cheaper to finish than to arbitrate, so the page stops waiting and the job runs on.
- **Every wait needs an owner's lifetime.** A question parked for a resource (a suspended device) must end with whoever asked: its requester's lifetime, or the live turn's. An unsignalled wait outlives everyone, and a UI that waits on it (the stage's one frame at a time) stays busy for good.
- **A suspendable device must be invisible to its users.** Ending a worker is cheap, but whatever the service believes the device holds (the subject head, the live source) has to come back with the next one, and a question asked meanwhile has to wait for the owner's admission rather than make a device of its own.
- **The GL-object counter keeps listing objects that died in a context loss.** A probe section that runs after a context loss must compare against its own baseline.

**What 4a-v needed from this** (built in §11): a preparing state between built and shown, progress in the pane's quiet line instead of the one-off notice, and `show(view)` through the owner.

**Review fixes** (Sol's review of 4a-v: two High, two Medium, all fixed at the root).

1. *High: authored makeup arrived after preparation.* Layers were connected only at show, so preparation saw an empty stack and a cold V with authored makeup compiled its plate, composited and uploaded in its first shown frame; the probe hid it by setting layers itself. Now the head fills its surfaces before preparing and show keeps them (*The authored makeup before show*, above).
2. *High: a lost context could leave a preparation polling for good.* It held programs from before the loss. Now it restarts across the loss (*A lost context restarts the preparation*, above).
3. *Medium: compiling ahead changed a live depth material.* `shadowDepthMaterial` wrote into a mesh's own `customDepthMaterial`, and its second call flipped the side again. Now every field it writes is put back after the compile. The contact-prepass variant is then read from the depth material as it is drawn, and the next redraw's turned-over side is compiled too (PREV-208): with the old mutation gone, the first probe run found the cold V's warm-up linking that one depth variant, and the second run links none.
4. *Medium: the composite's preparation ignored cancellation and kept its shaders.* Now its wait is abortable, and its passes' programs free their shaders on release.

The bun tests for all four (above) and the T2 probe with the production feed and the context-loss gate pass (results above).

**What 4a-vi needed from this** (built in §13).

- **Routing by named view.** The owner shows one drawn scene. Routing a view action to the named view's runtime, and readiness per scene for the loaders (the `savedAppearance.ready` port reads `heads.shown()`), replace the single attachments the shown head makes (`attach({ preview, motion, … })`).
- **The editors per view.** The shown head mounts the on-head editor in `show`; `preview/browser/scene-editors.ts` takes that over per view, and exception 17 goes.
- **T3** (`measure.ts` in this folder) can drive a body switch through the production page: `xfStudioSceneEvidence().residency` lists the residents and the build in flight.

## 11. Chunk 4a-v: prepare before showing, with progress (built)

It closes S2's second defect: a lighting setup's or a V's first draw froze the page while its programs linked in one blocking task (94 s on a cold program cache). Every program a hidden runtime's first frame would link is now compiled ahead and linked on the driver's threads, so the page never waits on the link itself. Behind progress, the link still takes as long as the driver needs (about 35 s for a cold masculine V on synthetic heads, below).

**What changed.**

- **Prepared before shown** (`preview/scene-residency.ts`). The residency owner now builds a runtime, then prepares it (the port's `prepare`), and only then shows it, so the previous V stays drawn until the new one is *prepared*, not just built.
  - A want superseded while it prepares stops at its next step and is disposed, never shown.
  - Preparation is work done ahead: one that fails for any reason but an abort still shows the runtime, whose first frame then does the rest, so the person's choice is never lost to it.
  - A warm runtime is shown at once while it is still prepared (the port's `prepared`). One that needs preparing again (its lighting or what it draws changed while warm) is prepared first, with no build, and stays warm if that is superseded. Evicting or losing one stops its preparation first.
- **Progress, typed.** The owner publishes `PreparationState`: the scene and key, the stage (`core`, `build`, `details`, `programs`, `textures`, `warm-up`), an overall fraction that only grows for one want, what it waits on (`host`, `files`, `driver`, `gpu`), the host's own line while it prepares a core, and whether the runtime was warm. Stages never go back. Each stage has a weight, and only the stages a want goes through count (a masculine V's core first).
- **The runtime's preparation** (`platform/scene/runtime-preparation.ts`, `SceneRuntime.prepare`). It runs in small steps between frames, each within `PREPARE_FRAME_MS` (8 ms) of the page's thread:
  1. **The feature renderers' own passes** (`FeatureRenderer.prepare`, new and optional): eye makeup compiles its composite's three passes ahead (`createPlateComposite().compile`), then composites, so its merged plate exists and is visible as the first frame draws it. Its wait on the links is abortable (`platform/api/abortable.ts`): a superseded preparation lets go at once rather than when the driver finishes.
  2. **Every mesh the next frame draws**, through the lighting stage's `prepare`: the forward scene, the scatter and contact variants, and each caster's shadow depth variants. The shadow pass's pick of a depth material is reproduced (`shadowDepthMaterial`, after three r186's `getDepthMaterial`), including the variant it picks when the maps redraw inside the contact prepass, where every caster wears its depth material. A mesh's own `customDepthMaterial` is live (the contact prepass draws with it), so every field the pick writes on it is put back once the mesh is compiled: compiling ahead changes nothing that is drawn. Each mesh is marked as receiving shadows before it is compiled, as the frame marks it: Three keys a program on it.
  3. **The display's own passes** (`prepareDisplay`): the game grade or the studio's coverage and tone passes, the skin scatter's blur, and a stand-in for Three's background plane (`BackgroundMaterial`, otherwise linked inside the first studio frame: 2.3 s cold).
  4. **Links.** With KHR_parallel_shader_compile the preparation asks, once a frame and without waiting, how many programs are linked, then takes each one's first use a few per frame. Without it a fence stands in (see the fallback below). Steps 2 to 4 go about one program per step, with only a few linking at once (4a-v-b, below).
  5. **Textures.** The maps the compiled materials hold (their own properties and uniforms: Three copies built-in maps into uniforms only when it draws), uploaded a few per frame, a large one in bands, each once the GPU process has caught up (4a-v-b).
  6. **Hidden warm-up draws** on the renderer device (`RendererDevice.warmUp`), in pieces since 4a-v-b. The hidden runtime draws exactly as shown, and in the same task the device draws the shown runtime again, so the canvas keeps the shown V's pixels and nothing of the hidden one reaches the screen. They build what only a draw makes (the driver's input layouts, frame-sized targets, three-target pixel shaders), and a fence after each piece is waited for a frame at a time. Warm-ups count in the slot's `warmUps`, never in its `frames`.
- **A lost context restarts the preparation** (`acrossContextLoss`). A program compiled before a loss holds a handle the restored context doesn't know, so its link never completes and a preparation polling it would wait for good. The renderer device publishes its context's generation (`contextSignal`, aborted on loss; the context-generation rule below) and when it is usable again (`contextReady`, after every runtime restored its own). Each attempt runs under that signal as well as the want's, so a loss stops it at its next step and drops the programs it held; once the context is back the preparation starts again from the beginning, reporting `programs` waiting on the GPU meanwhile. Only the want's own abort, or a failure that isn't the loss, ends it unfinished.
- **What a preparation leaves behind.** Three deletes a program's shaders only at its first use, so a program compiled ahead and released unused (a superseded preparation) left both shaders on the driver. `releaseShadersWithPrograms` (`materials/render/linked-programs.ts`) deletes them with the program, for the lighting stage's programs and the plate composite's passes alike. The renderer's scenes now share one prefiltered room (`studio-environment.ts`): it took 32–61 ms of the page's thread per runtime, and the last runtime to go frees it.
- **The head** (`browser-head-attachment.ts`, `AttachedHead.prepare`). It asks for the V's details on a head of their body and waits until they are placed (shown, failed or waiting for WolvenKit), reporting the host's progress. The V's own makeup is hidden as the view hides it. Then it fills each layered surface with the authored makeup as it is now, and prepares the scene with it, together with the lighting setups of any other view of the same scene (phase 4a has none). `prepared()` is the scene's.
- **The authored makeup before show** (`browser-preview-device.ts`, `fillScene`, `connectScene`). The preview device fills a hidden surface from the layers as they are (masks, layers and their optical maps), and the surface holds that snapshot detached: while any surface holds a canvas, a newly completed mask is painted on a new canvas, never over the held one. Connecting the surface at show keeps what it holds and brings only the slots whose mask, layer or maps changed since, so a prepared V's first shown frame has nothing left to compile, composite or upload; a surface holding nothing (or another stack or tier) is given every layer, as before. A surface that stops being shown holds what it had, so a warm V shown again only catches up too, and its head's release drops the hold. Each slot's latest optical maps are kept for this, as the arrays the stack's textures already hold.
- **The owner** (`browser-scene-heads.ts`). A masculine V's want starts with the `core` stage, and the host's line goes with it. The typed state goes to the presentation (`preparation` port, then `ViewportAttachment.setPreparation`, read as `viewport.snapshot().head.preparation`). While nothing is shown, the pane's loading progress follows the overall fraction too. 4a-iv's one-off notice ("… The V shown now stays until it's ready.") is gone.
- **`show(view)` for phase 2's tabs** (`heads.show(view)`). The drawn view becomes `view`, and its scene's head is wanted like any subject change: the head shown stays drawn, with progress, until that one is prepared. A newer want supersedes it, and a view that doesn't exist is refused. `shownView()` reports it. The root gives the owner `scenes.of(view)`.
- **In the pane** (`studio-ui/panels/viewports.ts`, `studio-ui/preparation-text.ts`). While a V is shown and the next one is prepared, the quiet status line says which stage it is in, worded "Next V: …", with a thin bar along its foot for the fraction. While nothing is shown, the pane's loading state says the stage, with its bar. Neither carries a step count (the bar says how far), and both say the core head in the same words. The line appears only once a preparation has run for 150 ms, so a quick re-preparation of a warm V never flashes it. It keeps one width for every stage, and every `next` string fits one line at the narrowest width (at most 26 characters, a tested budget; a sentence is never cut), so its box keeps one height. The UI review's first fix list (23 October) is applied: shorter lines, no step count, the eye-shape note naming both shapes ("This head has no shape 24, so it shows shape 1; …", `eyeShapeFallback`), "Getting the look ready…" for the programs stage, and a capture tool that reads only visible text. The recapture is `generated/4a-v-2/` (`tools/preparation-look.ts`, which also covers a ~300 px pane). The style guide's *Viewport overlays* entry gained the quiet line's three forms (written first, as the UI component track); no new component was needed.
- **The parity tool** (`tools/scene-parity.ts compare`, rule in `tools/parity-rule.ts`). It applies the revised rule of §8: a frame passes when, against its nearest base, it differs by at most one channel step on fewer than 0.01 % of its pixels. The report gives each frame's figures and the worst frame's. On G1's captures it gives 17 identical, 3 within noise, worst `board2-studio-1024`: 8 of 460,192 pixels (0.0017 %), one step.

**Gates.**

- **T1, residency** (`tests/scene-residency.test.ts`, 5 new tests on the injected clock; the 12 earlier ones unchanged):
  - the previous runtime stays shown until the new one is built and prepared;
  - progress is typed, never decreases, never goes back a stage, says its driver wait and ends;
  - a want superseded while it prepares stops within 100 ms of clock, is disposed and never shown, and its late reports are ignored;
  - a warm runtime still prepared is shown in the same turn, and one that isn't is prepared first and stays warm when superseded;
  - a failed preparation still shows;
  - evicting a warm runtime being prepared stops it first.
- **Preparation leaves things as they were, and survives a lost context** (`tests/runtime-preparation.test.ts`): compiling ahead leaves every mesh's material and its own depth material as they were, side included, while still compiling the depth variants; a context lost while a V's programs link drops them, waits on the GPU, starts again after the restore, and the V is shown; the want's own abort still ends it while the context is lost, and another failure isn't retried.
- **The head, through the production flow** (`tests/browser-head-attachment.test.ts`, 2 new, with the real preview device and a real makeup stack): a cold V's authored layer is on its surface before its scene is prepared, and showing it changes no material, texture, image or version and leaves no composite pending (then the next mask reaches it live); a surface filled ahead keeps its snapshot while a newer mask completes (painted on a new canvas, the held one untouched), and show brings only that slot up to date.
- **Composite cancellation** (`tests/scene-feature-renderers.test.ts`): with links that never finish, a superseded eye-makeup preparation is released at its abort (well within 100 ms), and the composite's three unused programs free both shaders each on release.
- **The owner** (`tests/browser-scene-heads.test.ts`, 2 new):
  - a new head is prepared while the old V stays drawn, its typed progress (`core` first for a masculine V) reaches the presentation, moves forward and ends, and nothing is noticed;
  - `show(view)` wants that view's scene's head, keeps the shown one until it is ready, shows a warm one at once, and refuses a missing view.
- **Words and plumbing** (`tests/preparation-progress.test.ts`): the attachment carries the state beside the phase and drops it; every stage has a plain line in both places, with no developer words and no step count; every `next` line stays within the character budget (one line at the narrowest width).
- **Parity rule** (`tests/scene-parity-rule.test.ts`).
- **T2, the preparation probe** (`tests/webgl-scene-preparation.test.ts`, page `tests/webgl-scene-preparation-probe-page.ts`). Synthetic heads, a fresh headless Chrome profile per run (a cold program cache), the production ports' shape under `SceneResidency`, and a counted context with links and uploads counted. The authored layer reaches each runtime through the production preview device: filled before its preparation, connected at show (until the review fixes, the probe set it on the stack at build, which hid that production filled it only at show). It runs twice, with KHR_parallel_shader_compile and without it (the extension hidden: the fallback). Its gates:
  - a first V with nothing shown;
  - a cold V (the other body under the game's creator rig: programs never linked in the page) wanted while the first is shown;
  - eight warm switches;
  - a cancel while the third V's programs are prepared;
  - closing everything;
  - a context lost while a cold V's programs link (run after closing, since a lost context's objects are never deleted): its preparation restarts after the restore, and the V is shown and draws.

  The cold V's first shown frame still uploads no map with the authored layer on it: its mask is on the surface from the fill on, so it is uploaded while the runtime is prepared.

**Results** (23 October 2026, with the review fixes below and the authored layer fed through the production preview device; RTX 4070, ANGLE D3D11, headless Chrome; every run under the 3 GB guard, peak 1.4 GB):

| Gate | With KHR_parallel_shader_compile | Without it (fallback) |
|---|---|---|
| Longest main-thread task, cold V, from the want to 1 s after it is shown (< 50 ms) | **none of 50 ms or more** | 13.7 s (2 tasks over 50 ms) |
| Cold V, want to first presented frame | 30.0 s (17 programs linked on the driver's threads, behind progress) | 30.0 s |
| Cold V, show to first presented frame | 32.6 ms | 32.3 ms |
| Cold V frames before shown / hidden warm-ups | 0 / 1 | 0 / 1 |
| Shown V's pixels while the cold V prepared | unchanged | unchanged |
| Cold V's first shown frame: links, programs made, uploads | 0, 0, 9 (a later frame also sends 9: its bone matrices) | 0, 0, 9 (9) |
| Links in any warm-up draw, the renderer's first included | 0 (warm-ups 6–10 ms) | 0 (6–10 ms) |
| Warm switch, want to first presented frame (≤ 100 ms) | 1.1–15 ms (8 switches) | 1.3–18 ms |
| Cancel while compiling, superseding want to stop (≤ 100 ms) | 3.6 ms; nothing drawn, GPU objects back | 0.1 ms; the same |
| Progress | stages in order, fraction never decreasing, 31 steps in `programs` | the same, 24 steps in `programs` |
| Closing everything (4a-i's gate with preparation) | GPU objects and programs at the baseline (`BackgroundMaterial` used once) | the same |
| Context lost while a cold V's programs link, restored 0.2 s later | the preparation restarted once, the V was shown and drew | the same |

Before the fixes in this chunk, the same probe found the cold V's warm-up draw linking 5 programs in one 36–44 s task, the first V's linking 8 in 5.2 s, and a superseded preparation leaving 4 shaders. The probe's own diagnostics name what was linked where (`warmUpPrograms`, `links`, `slow`), and that is how each was found:

- the merged makeup plate, visible only after its first composite;
- the composite's and the scatter's own passes;
- the shadow depth variant picked inside the contact prepass;
- the background plane;
- meshes compiled before they were marked as receiving shadows.

| Other runs | Result |
|---|---|
| Scene, view, preview, character, viewport, motion, residency, lighting, render, head, parity, preparation, UI, style-guide, makeup, feature-renderer, startup, workspace, profiles and boundary tests | 106 files: 1,043 pass, 5 skip (real-game oracles), 0 fail (peak 1.7 GB) |
| WebGL probes after the review fixes | preparation 9 (both runs), plate composite 8, renderer device 9, studio lighting 4: all pass (peaks 0.8–1.4 GB) |
| WebGL probes before them | scene dispose 4, scene host 7, body 6, clothing 7, display 12, eye 5, contact shadow 3, skin scatter 8, choice preview 6: all pass (peaks 0.5–1.5 GB) |
| `bun run check` | passes |

**The fallback (no KHR_parallel_shader_compile).** It stays chunked and reports progress, but it can't keep the page free. The fence trick assumes a link has finished once the GPU process has worked through the commands sent so far. ANGLE still links on its worker threads, so the fence signals early, and the first use of a program then blocks until its link is done (13.2 s for the slowest cold program). Without the extension the page has no way to ask whether a link is done without waiting. Chrome on Windows always offers the extension, so the fallback matters for other browsers and GPUs.

**Decisions and caveats.**

- **4a-iv's page didn't start in a browser.** Wiring made before the scene runtime owner (the live face's following, the UV editor's first draw, the status source) read `heads` at once, before `const heads` existed, so the page stopped with a ReferenceError. No test starts the real page; the first real-browser run since 4a-iv (this chunk's capture run) found it. The root now reads the shown head through `shownHead`, which answers nothing until the owner is made. `tests/studio-startup-order.test.ts` checks the source order and fails on 4a-iv's.
- **The first load is prepared too.** With nothing shown, the pane shows its loading state through every stage, and the head appears with its V's details, programs and maps ready, rather than bare and filling in. On a warm host that adds the details' time (about 1 s) to the time before the first head.
- **The first build's room.** The first runtime on a renderer still prefilters the room on the page's thread, with PMREM's own programs linked inside it: 0.4 s cold, 80–100 ms warm (the probe's first V: one task of 98–164 ms). Later runtimes share it. Sharing it with the first build too, or moving the prefilter off the page's thread, is a performance-track item.
- **The cold link time itself** (35 s on synthetic heads, 94 s in S2 on real data) is moved off the page's thread and behind progress, not removed: 40–47 s on real data for a lighting change or a body under the creator rig (G2 after 4a-v-b, below). Its size stays a performance-track item.
- **A lighting change on the shown view** is prepared ahead too (4a-v-b, below): the new setup is staged, prepared while the setup before stays drawn, and takes over once ready.
- **A finding on the way (not changed, to keep parity; PREV-208).** The shadow maps are redrawn inside the contact prepass, whose casters wear their depth materials. Three's shadow pass then picks a depth material for the depth material itself, and turns its cull side over on every redraw (`shadowSide[material.side]`). So the maps are drawn with front-face culling on one redraw and back-face on the next. Compiling ahead covers both variants, and itself changes no depth material's side (it puts back what it wrote). Whether the maps should be drawn once per frame outside the prepass is the ledger's PREV-208.
- **Details catch up on a warm V.** A warm head shown again is shown at once, then catches up with its V as before (an update in place), because preparing its details first would make every warm switch wait for the host.
- **Uploads in a frame.** The first shown frame still sends what every frame sends: the bones' matrices (9 small updates here), as a later frame does. The gate counts map uploads.
- **The UI captures** are taken with a verification hook (`xfStudioShowPreparation`), so each stage is drawn by the pane's own code at a known fraction. A real switch passes through the same states too quickly to capture. The tool is `tools/preparation-look.ts <out dir> [port]`: an isolated server with throwaway data, one Chrome at a time, light and dark at a narrow and a wide window, and the Character panel's eye-shape fallback line from a real body switch. The line's box is recorded in each stage. Server and Chrome together need about 5 GB with the real default V. The captures wait for a window with enough free memory (none yet), so the UI review is still to come.
- **The Body switch before the details.** A head's preparation sets the V's context to the view's Body switch and uncensored setting before it asks for the details, as `show` would. They are the view's, the same for every head of the scene, so a hidden body is never loaded only to be dropped at show.

### 4a-v-b: closing G2's failures (built)

G2's first run (23 October, the "before" column below) failed on six findings. This part closes four of them and narrows the fifth to one cause outside the page; the sixth (a body's long tasks) is down to one borderline task.

**What changed.**

- **A lighting change on the shown V is prepared ahead** (finding 4, PREV-209). The scene runtime no longer draws a setup whose programs no preparation has readied (`setLighting`, `platform/scene/scene-host.ts`).
  - It stages it beside the drawn setup (`preview/render/lighting-setup-stage.ts` `stage`): the staged setup has a light rig of its own, outside the scene, and its own shadow-map fingerprint. `withStaged` puts it in place only for the length of one synchronous call, then puts back everything the call changed, the casters' own depth materials included (PREV-208 turns them over in every shadow redraw).
  - The runtime says it needs preparing (`onUnprepared`). Its owner prepares it like a warm runtime: `SceneResidency.refresh` calls the port's `prepareShown`, the head's `prepareShown`, then the runtime's `prepare`. That compiles every drawable in steps, uploads the new maps and draws the warm-up in pieces, all under the staged setup. Every frame between steps still draws the setup before.
  - At the end the staged setup takes over (`setSource` adopts its rig, with the lights and shadow maps its warm-up made). A failed preparation still hands over, so the choice is never lost; only an abort stops it.
  - A value edit (same programs: a light dragged, an exposure) and a setup prepared before are drawn at once, as before.
  - The status line says "Lighting: getting ready…" and then "Lighting: almost ready…" with the same bar (`studio-ui/preparation-text.ts`, `PreparationState.change: "shown"`). The bar is now named by the line beside it (`aria-labelledby`).
- **Decision: a setup change is a want on the shown runtime, owned by the residency.** The residency already owns every preparation (supersession by `AbortController`, typed progress, eviction), so the shown runtime's change gets the same rules without a second owner:
  - a newer change of the shown runtime restarts it;
  - a want for another runtime (a body or V change) supersedes it, and the hidden runtime then takes the staged setup at once, to be prepared before it is shown again;
  - the setup drawn, asked again, stops it at once.

  Doing it inside the runtime alone would have needed its own abort, progress and interplay with the residency's builds, which is two owners of one runtime's preparation.
- **Compiling ahead goes in steps of about one program** (finding 2, the `details` and C's compile tasks). `prepareSteps` (lighting stage) gives one step per drawable's forward program and one per pass variant of each mesh. Both the runtime's preparation and the V's details (`character-renderer.ts prepareDetails`) let a frame through whenever a step used up its share. One part's compile in one call was 294–306 ms.
- **Only a few programs link at once** (`platform/scene/link-pacing.ts`): a quarter of the cores, two to six (five here). Asking for all of a setup's links at once (20–50) started that many D3DCompile jobs in the GPU process and took every core: the page's own thread then sat in tasks of 100–500 ms with nothing of its own in them (C's "compile steps" of up to 857 ms, and B's 103–489 ms once prepared). The programs stage takes about 15 % longer. A wait for a slot ends when the preparation's signal aborts (superseded, or the context's generation ended), never only when a link finishes.
- **Large maps upload in bands** (`character-detail-loader.ts uploadStep`). A decoded map of 2048² or more gets its storage first (Three's `dataReady` off), then one band of 512 rows per step (`copyTextureToTexture` from its bitmap), with the mipmaps made after the last band. Any caller continues a banded upload where another stopped, while its storage holds (below). A map larger than the renderer's texture limit goes whole through Three's own upload, which makes it smaller first. A 4096² map whole took 35–63 ms; a band takes 5–15 ms.
- **Uploads wait for the GPU process, a frame at a time** (`platform/scene/gpu-gate.ts`). Each upload step is sent only once a fence after the previous one has signalled. A 1024² map's upload took 141 ms when it was sent while the GPU process was busy building a shader: the call waited for room to pass its texels. The gate's owner deletes its last fence when it is done (a preparation in `finally`, the character renderer on disposal).
- **The on-head editor's guides are compiled with the head** (finding 3). `LineBasicMaterial` and `PointsMaterial` were the on-head editor's handles and outlines, added to the scene at show. The viewport device makes stand-ins with the same materials for each head (`surfaceGuideStandIns`). Its preparation compiles them, and they keep the programs alive while the head lives.
- **The show task is light** (finding 2). Mounting the editor built the plate's surface map and the head's occlusion tree (90–115 ms). They are now made ahead, a step per frame (`surfaceEditorParts`, the preparation's `work`). The tree is built from a typed table of triangle centres instead of a map of vectors (the same arithmetic, so the same tree).
- **Warm-ups are drawn in pieces** (finding 6). The hidden runtime is drawn with only a few drawables visible (`drawables.ts drawOnly`), then the device draws the shown runtime as usual, and the next piece waits, a frame at a time, for a fence. Pieces start at one drawable and double while the GPU keeps up. A drawable drawn into the skin scatter's three targets goes in a piece of its own (`drawsMultiTarget`). A last draw of everything follows. The renderer device's `warmUp(slot, draw)` also warms up the shown runtime under a staged setup.

**What still holds the screen (finding 6, root cause).** A Chrome trace of G2's B switch (`measure.ts` with `G2_TRACE=B.lighting`, and the T2 page traced the same way) shows what the GPU process does while no frame is presented. ANGLE on D3D11 links each program's pixel shader for its first output only, on worker threads. A program that writes three outputs gets its real pixel shader at its first draw into a three-target framebuffer, compiled synchronously on the GPU process's main thread (`D3DCompile` with `SV_TARGET0–2`, under `CommandBufferService:PutChanged`).

- **Which programs.** Those are the skin scatter's input variants (skin, brows, face decals, mouth), plus the layered bakes and the makeup composite, which draw to two targets.
- **How long each build takes.** On real data a skin variant took 1.1 s under the studio setup and 5.9 s under the creator rig; on synthetic heads, up to 13–15 s. Nothing is presented meanwhile, so the shown V and the progress line freeze for that long.
- **No variant can be made ahead.** Binding a three-target stand-in while linking changes nothing, because ANGLE takes the layout from the shader, not from the bound framebuffer.
- **A kept profile doesn't build them again** (measured in 4a-v-c, §12): the second session on a profile built one of them, the third none.
- **What fixed it** (4a-v-c, §12): every program writes one output, and every joint index is a float.

Pieces cut the freeze from the whole warm-up to the longest single build. G2 still fails its "progress keeps repainting" gate on that one build.

**Gates.**

- **T1** (`tests/scene-residency.test.ts`, two new tests on the injected clock):
  - the shown runtime is prepared again while it stays shown, its progress says `change: "shown"`, and a newer change restarts it;
  - a want for another runtime supersedes it, it waits while another runtime is wanted, and a change back to what is prepared stops it.
- **The owner** (`tests/browser-scene-heads.test.ts`, one new): an unprepared shown head is prepared again with only its scene's `prepare` (no details, no other setups), stays shown and reports `change: "shown"`. A body change then supersedes it.
- **Link pacing, the GPU gate and banded uploads** (`tests/link-pacing.test.ts`, `tests/character-preload.test.ts`):
  - the limit is a quarter of the cores, two to six, and a new program waits while the limit is linking;
  - an upload is sent only once the GPU caught up;
  - a 4096² map takes its storage, then eight bands with the mipmaps after the last, and its bitmap closes then.
- **Words** (`tests/preparation-progress.test.ts`): the lighting lines fit the one-line budget and use no developer words.
- **T2** (`tests/webgl-scene-preparation.test.ts`, 11 tests, 2 new), on the synthetic heads, with and without KHR_parallel_shader_compile:
  - the cold V's warm-up is drawn in pieces, with frames presented between them;
  - a setup with spot lights never drawn, asked of the shown V:
    - is staged, and the setup before stays pixel for pixel until the new one takes over;
    - takes over with no link and no program made in its first frame;
    - has no task of 50 ms or more from the change to 1 s after it, with the extension;
    - reports `change: "shown"` and moves forward only;
    - a newer setup asked meanwhile is the only one ever drawn;
    - the drawn setup asked again stops the preparation at once.

  The GPU objects return to the baseline after everything closes; the staged preparations that were stopped first leaked shaders, until each step freed its own.

**Results** (23 October 2026; RTX 4070, ANGLE D3D11; synthetic runs under the 3 GB guard, peak 1.5 GB):

| T2 gate (synthetic heads) | With KHR_parallel_shader_compile | Without it |
|---|---|---|
| Cold V: longest task from the want to 1 s after the show | none of 50 ms or more | 11.1 s (4 tasks) |
| Cold V: pieces, frames presented during its warm-up, longest frame gap | 6 pieces, 18 frames, 13.9 s (one three-target build) | 6, 18, 13.3 s |
| Cold V: first shown frame links / programs made | 0 / 0 | 0 / 0 |
| Setup on the shown V: change to takeover | 7.4 s | 7.4 s |
| Setup: longest task from the change to 1 s after | none of 50 ms or more | 2.0 s (3 tasks) |
| Setup: pixels until takeover; links and programs in its first frame | unchanged (9 checks); 0, 0 | unchanged; 0, 0 |
| Setup: longest frame gap while prepared | 4.0 s (one three-target build) | 3.9 s |
| Setup replaced meanwhile / back to the drawn setup | only the newest drawn / stopped in 0 ms | the same |
| Warm switches; cancel | 4–9 ms; 6.4 ms | 4–6 ms; 0.2 ms |
| Other WebGL probes (renderer device, disposal, scene host, studio lighting, plate composite) | 32 of 32 pass | |

**G2 on real data, before and after.** The same harness and setting as the first run (below): the default feminine and masculine V from the local game files, a fresh headless Chrome 155 profile per run, RTX 4070 on ANGLE D3D11 with KHR_parallel_shader_compile, an isolated server with scratch caches.

- **Before:** runs 2 and 3 of 23 October, at `655e5028`.
- **After:** two runs at this chunk's last commit (`after-run1`, `after-run2` in the ignored `generated/g2b/`). Another program, a game, was open on the machine during them (about 20 % CPU overall).
- **Measured windows.** B is now timed like a switch, from the request to the frame the new setup takes over in. The frame gap is a new gate: no 500 ms without a presented frame while preparing.

| Switch | Before (runs 2, 3) | After (runs 1, 2) |
|---|---|---|
| **A: body.** Request to first presented frame | 11.8 s, 9.9 s | 14.7 s, 10.3 s (run 1's details stage took 8.4 s on the host) |
| A: tasks of 50 ms or more during preparation | 3 (max 294 ms), 3 (max 226 ms) | 1 (52 ms, the first warm-up piece), 0 |
| A: tasks of 50 ms or more in the second after the show | 1 (94 ms, the show), 1 (90 ms) | 0, 0 |
| A: programs linked in the first shown frame | 2, 2 (`LineBasicMaterial`, `PointsMaterial`) | 0, 0 |
| A: longest frame gap during preparation | 4.2 s, 4.1 s | 1.8 s, 1.8 s |
| **B: lighting** (the creator setup on the shown masculine V) | one blocked task of 104.0 s, 91.9 s; 38 links in it; no progress | prepared: 41.0 s, 39.6 s to takeover, with the setup before drawn throughout |
| B: tasks of 50 ms or more | that one task | 0, 0 |
| B: links in the first frame under the new setup | (all 38) | 0, 0 |
| B: progress | none | "Lighting: getting ready…", then "Lighting: almost ready…", on every frame; fraction never decreasing |
| B: longest frame gap | 104 s, 92 s | 17.8 s, 16.9 s |
| **C: body and lighting.** Request to first presented frame | 57.8 s, 53.1 s | 46.3 s, 46.8 s |
| C: tasks of 50 ms or more during preparation | 13 (max 849 ms), 6 (max 857 ms) | 0, 0 |
| C: tasks of 50 ms or more in the second after the show | 1 (115 ms), 1 (97 ms) | 0, 0 |
| C: programs linked in the first shown frame | 2, 2 | 0, 0 |
| C: longest frame gap during preparation | 35.7 s, 32.8 s | 18.9 s, 19.1 s |

**Verdict: still FAIL, on one gate.** Long tasks during preparation are down to one task of 52 ms in one of six switches: the first warm-up piece, where Three builds the head's morph-target texture on the page's thread. Links in the first shown frame are zero everywhere, and progress is shown throughout. Frames stop being presented for the length of one three-target pixel shader build at a time: 1.8 s in A, 17–19 s in B and C. That is the root cause above, and the fix is the scatter-input split.

**G2 before (23 October 2026, the first run).** The detail behind the "before" column, at `655e5028`, harness `ff73dc4b`, the game not running:

- **A.** Three long tasks per run (67–294 ms) in the details and textures steps, a show task of 90–115 ms, and two overlay programs linked in the first shown frame.
- **B.** Not prepared: one blocked task of 89–104 s.
- **C.** Compile steps of up to 857 ms, and no frame for 33–36 s during the warm-up's GPU wait.
- **The server's peak.** On the fully cold first run it was 4.0 GB, with every cache empty (both cores, creator options, poses, icons, details). It was killed twice under `--limit 3` at 3.1 GB. Warm caches peaked at 1.7 GB. This is noted only; it isn't changed here.

**First load (outside the gate).** The page's first V on a fresh profile links 80 programs, takes 2.2–2.8 s of CPU for its first frame, and has long tasks of 0.5–2.8 s in its first 15 s. The first build's room prefilter and programs are the known cost (the "first build's room" caveat above). It belongs to the load-time track, and so do the three-target builds above, which every session probably pays again.

### 4a-v-b review fixes: GPU state lives as long as its context (built)

The 4a-v-b review (Sol, 23 October) found seven problems, and its confirmation pass two more of the same kind. Most shared one cause: state on the GPU, or a record that the GPU held something ready, outlived a lost context. After the restore that state pointed at nothing, and a wait on it never ended.

**The context-generation rule** (`platform/scene/context-generation.ts`). A generation is the life of one WebGL context. It ends when the context is lost and the next begins when it is restored. The renderer device drives it from its canvas's context events. `contextGeneration(renderer)` gives the generation's signal (also the device's `contextSignal`), and every read of it checks the context too, so loss is found in one place whoever asks:

- a context found lost before its event arrives (the browser queues it) ends its generation there and then;
- a generation found ended while the context is usable again (restored, its event not told yet) gives way to the next, which the event then keeps.

Anything that holds GL objects across frames, or records GPU readiness, keeps the signal with the state:

- before it reads or reuses the state, it checks the signal against the generation read again (`inGeneration`, or the device's `contextSignal` in the scene host), never against the kept signal alone: a kept signal stays live until someone reads the generation after the loss;
- it treats the state as gone once that check fails, and never deletes a lost context's objects (they went with it);
- any wait on the state runs under the signal, so it ends with the generation (by abort, or a restart after the restore) instead of waiting for good.

Owners keep the signal themselves rather than registering with a central scope: each one checks it where it reads its state, and nothing has to be told.

| Review finding | What holds the generation now |
|---|---|
| 1 (High). The upload gate survived a restore; its old fence's status read `null` with the context not lost, so every later upload waited for ever | The gate's fence (`gpu-gate.ts`) keeps the generation it was made in. Once that has ended the gate is idle and the fence is forgotten. A status the context doesn't report counts as passed. |
| 2 (High). `links.admit()` ignored cancellation, so a superseded or lost-context detail preparation could wait for ever | `admit(signal)` ends when its signal aborts. The details' preparation (`character-renderer.ts prepareDetails`) runs under its own signal and the generation's, so a loss stops it at once. The runtime's own preparation, restarted after the restore, compiles what is placed by then. Which parts are prepared is a record of the generation too. |
| 3 (Medium). Band state survived a restore, then copied from a bitmap Three's own upload had closed | Band state keeps its generation, and goes on only while its storage is still the texture's (the same generation, the same texture version) and its bitmap is open. Otherwise the upload starts again, from the bitmap while it is open, else as an ordinary upload from the image. |
| 4 (Medium). A staged lighting change was stranded when another want superseded its preparation and the person came back, or that want failed | Not a GPU matter: the residency now remembers a change of the shown runtime put off by another want. If that want ends with the runtime still shown (it failed, or the shown runtime was wanted again), the change is prepared then. If the other runtime is shown instead, the hidden one takes its change at once, as before. |
| 5 (Medium). `preparedFor.lighting` survived a restore though Three drops its programs, so a setup prepared before the loss was drawn at once and linked in its first frame | The record keeps its generation (`scene-host.ts`), and one from an ended generation readies nothing. Such a setup is staged and prepared again. |
| 6 (Medium). Band sizes ignored Three's texture-size clamp; an 8192² map on a 4096 renderer copied 8192-wide bands into 4096² storage and was still marked complete | A map larger than `capabilities.maxTextureSize` goes whole through Three's upload (which makes it smaller). A band whose storage no longer holds starts the upload again and is never counted done. |
| 7 (Low). The gate's last fence was never deleted | The gate has `dispose`. The runtime's preparation calls it in `finally`, the character renderer on disposal, and fence drains (`gpuDrained`) delete their own fence however they end. |
| Confirmation 1 (Medium). An incoming part's layered bake had no generation: restored while its preparation waited for a frame, it heard no `contextRestored` (neither shown nor kept), and placement reused its old, empty target with no re-bake | The layered handle (`materials/render/layered-material.ts`) keeps the generation its maps were baked in, and checks it before any read of its state or target, any bake and its disposal. Maps of an ended generation are dropped, the part is pending and hidden, and its next bake draws again. The renderer's shared bakes are kept per generation too, so a twin never reuses a dead target. A bake the loss cut short is tried again once the context is back. The bake's own loss check reads the generation. |
| Confirmation 2 (Medium). Before the queued lost event arrived, `isContextLost()` could be true while the kept signal was still live, so a setup prepared earlier was drawn at once | The scene host reads `device.contextSignal()` again before trusting `preparedFor`, and requires it to be the same generation and live. Reading the generation ends it when the context is lost, so the same check holds everywhere the rule applies (the gate's fences and band state use `inGeneration`). |

The staged lighting rig's shadow-map fingerprint is a GPU record too. The lighting stage's `restore` now drops it with the drawn rig's, so a staged setup adopted after a restore draws its (empty) maps again. The character renderer reads Three's texture records from `renderer.properties` each time, because a restored context replaces that object.

**Gates.**

- **Unit tests**, without a GPU:
  - the gate idle after a loss and restore between polls, never deleting the lost fence; a `null` status counts as passed; no fence while lost (`tests/link-pacing.test.ts`);
  - its last fence deleted on `dispose`, and drains deleting theirs however they end (`tests/link-pacing.test.ts`);
  - a wait for a link slot ending on abort (`tests/link-pacing.test.ts`);
  - a details preparation waiting for a slot, stopping on the want's abort and on the end of the generation, then prepared again only in a new generation (`tests/character-renderer.test.ts`);
  - the character renderer deleting its gate's last fence on disposal (`tests/character-renderer.test.ts`);
  - a banded upload interrupted by a generation restarting from its bitmap, and one whose bitmap Three closed meanwhile finishing without a copy (`tests/character-preload.test.ts`);
  - a texture changed part-way restarting, and an 8192² map on a 4096 renderer going whole (`tests/character-preload.test.ts`);
  - a put-off change of the shown runtime resumed after the shown runtime is wanted again, after a failed want and after a change asked while another want was built, but never for a runtime that was hidden (`tests/scene-residency.test.ts`);
  - a staged rig's maps drawn again after a restore (`tests/lighting-preset.test.ts`);
  - the generation itself, and a kept signal failing the check once the context is lost though its event is still queued (`tests/runtime-preparation.test.ts`);
  - a layered part baked before a loss and restore it never heard about: pending and hidden at its first read, baked again with new draws and a new target, a twin sharing only the new maps, and a bake while lost waiting for the restore (`tests/layered-material.test.ts`).
- **T2** (`tests/webgl-scene-preparation.test.ts`, page step 8, with and without KHR_parallel_shader_compile), each on a real context lost with `WEBGL_lose_context` and restored 0.2 s later:
  - a 2048² banded upload lost after its storage and two bands starts again from its bitmap, and every texel read back is the bitmap's, with no GL error after any upload step (the texture's own image is another colour, so a fill from the image would show);
  - a V's details lost while they wait for a link slot stop within 100 ms of the lost event, before the restore, and the V is shown and draws after it. Without the extension, the loss comes while they compile;
  - a lighting change lost while it is prepared on the shown V restarts, takes over with no link and no program made in its first frame, and leaves the V prepared;
  - the setup drawn before that loss, asked again, is staged and prepared again, never drawn at once, and also takes over with nothing to link;
  - a setup prepared since, asked in the very task the context is lost in (its event still queued), is staged too, and takes over after the restore with nothing to link;
  - 4a-i's disposal gate now also checks that no fence is alive at the baseline or once everything closed.

**Results** (23 October 2026; RTX 4070, ANGLE D3D11, headless Chrome; every run under the 3 GB guard):

| T2 step 8 gate | With KHR_parallel_shader_compile | Without it |
|---|---|---|
| Banded upload lost after storage and two bands | restarted: storage and four bands; texels all the bitmap's; no GL error | the same |
| Details lost while waiting for a link slot (without the extension: while compiling) | stopped 7.5–7.9 ms after the lost event, before the restore; the V shown and drawn | stopped 8.2–8.5 ms after it; the same |
| Lighting change lost while prepared on the shown V | restarted once; took over with 0 links, 0 programs in its first frame; prepared | the same |
| The setup drawn before that loss, asked again | staged, prepared again, took over with 0 links, 0 programs | the same |
| A setup prepared since, asked in the task the context is lost in | staged; took over after the restore with 0 links, 0 programs | the same |
| Fences alive at the baseline and once everything closed | 0 and 0; GPU objects at the baseline | the same |

The preparation probe passes 14 of 14 (peak 1.7 GB). The other WebGL probes pass too: renderer device 9, scene dispose 4 (4a-i's gate), scene host 7, studio lighting 4, plate composite 8 (peaks 0.8–1.2 GB). The probe was not run against the code before the fixes; the unit tests above fail without them.

One run's first read of the GL error after the banded upload found an `INVALID_OPERATION`. It came from no upload step: the next run read the error after each step and found none, so the gate now reads it there. Its source, somewhere else in the page between the last band and the read-back, is not known.

**What 4a-vi needed from this** (§12 and §13 built it, except the last item but one).

- **The three-target builds.** Done in 4a-v-c (§12).
- **The head's morph-target texture** is built inside the first warm-up piece's draw (about 30 ms of the 52 ms task). Three builds it at a mesh's first draw and offers no other way to make it.
- **The S2 gates in their final test form** (`tests/webgl-scene-runtimes.test.ts`). The preparation probe already measures the preparation half: warm switch, cancel, stray frames, long tasks, links and uploads in the first frame, the shown runtime's setup change, and the warm-up's frames.
- **Routing by named view** can use `heads.show(view)` and `scenes.of(view)`: a tab switch is then a want, and the view's preview and motion services follow the runtime shown.
- **Face shadows and skin scatter switches** still recompile on the shown V inside the next frame. The same staging would cover them (`programStateOf` already includes both switches).
- **A knowledge page on program linking in WebGL** (planned for 4a-vi) should take this part's findings:
  - ANGLE's draw-time pixel shaders for programs that write several targets;
  - links in parallel saturating the cores;
  - uploads that wait for a busy GPU process;
  - per-program compile steps.

## 12. Chunk 4a-v-c: no frame gap from multi-target programs (built)

It closes G2's last failure: frames stopped being presented while a body or setup was prepared (1.8 s on a body switch, 15–19 s with the creator rig). Every build ANGLE made on the GPU process's main thread at a draw is now gone at its source, so no frame is held back for one.

**What the GPU process built at a draw.** Each G2 switch was traced (`G2_TRACE=all` in `measure.ts`), and every `D3DCompile` sorted by thread: on ANGLE's worker threads at link time, or on the GPU process's main thread (`CrGpuMain`, inside `CommandBufferService:PutChanged`) at a draw, where nothing is presented until it ends. Two causes, both ANGLE on Direct3D 11:

- **A program that writes several outputs.** ANGLE links a program's pixel shader for its first output only (`GetDefaultOutputLayoutFromShader`), and builds the one for the bound targets at the program's first draw into them.
- **Integer joint indices.** Three declares `skinIndex` (and our `joints_1`) as `vec4` and feeds a glTF's `UNSIGNED_SHORT` JOINTS as they are. ANGLE links the vertex shader for float input, and at the first draw builds another that reads `uint4` and converts. That is once per program per skinned mesh, so each of a skin's passes paid it again. It is not a multi-output program, but it is the same mechanism, and with the first cause gone it would have held frames for 25–70 ms at a time.

**Inventory** (base `a0091847`, fresh profile, real data, RTX 4070; builds on the GPU process's main thread):

| Program | Role | Drawn | Outputs | Build at its first draw | Decision |
|---|---|---|---|---|---|
| Skin scatter input variants (`skin-scatter.ts`), one per distinct drawn material: skin, face decals lit as skin, the makeup plate, brows, and occluders (eyes, hair, lashes, clothing) | S0 lit irradiance and depth, S1 √albedo and slot, S2 metalness | every drawn frame while the scatter runs | 3 | studio setup: skin 136–148 ms, face decals 136 ms, plate 593–615 ms, brows 21 ms, eyes, hair and occluders 2–4 ms; creator rig: skin 1.05–1.19 s, decals 1.05–1.18 s, plate 5.1–5.8 s, brows 42–46 ms. A body switch built 9 (1.7 s), the creator setup 16–17 (17.9–21.1 s) | **(a) split**: three passes, one target each |
| Layered bake (`layered-material.ts`): the layer pass, the resolve, the clear | a part's packed maps | once per bake (piercings, eyes) | 3, 2, 3 | 14.8, 5.5 and 1.2 ms, once per renderer | **(a) split** the layer pass and the resolve; **(c)** the clear program goes (the targets are cleared) |
| Makeup composite (`plate-composite.ts`): the layer pass, the resolve | the merged plate | each composite update (a layer or the plan changed) | 3, 3 | 7.4 and 3.0 ms, once per renderer | **(a) split** |
| Every skinned program (not multi-output) | | every draw | 1 | a vertex shader for integer joints: 25–70 ms each; 24 (1.3 s) on a body switch, 37–39 (1.7–1.8 s) with the creator rig, 46 (1.9 s) on the first load | **joint indices as floats** at load (`floatJointIndices`) |

**(b), drawing ahead hidden, was not used.** The traces show the build inside the draw's own command-buffer task on the GPU process's main thread, whatever target the draw writes, so a hidden draw holds presentation exactly as a shown one does (4a-v-b's pieces only made the hold one build long). No hidden draw is needed once (a) applies.

**What changed.**

- **The skin scatter's input is three passes** (`platform/scene/skin-scatter.ts`). Each target (S0, S1, S2) has its own variant swap (`scatterInputPass(target)`) and is drawn in turn. They share one depth texture, cleared before each pass, so each target is drawn exactly as the one three-target draw drew it: the same scene, sort and depth test. A material writes its three values through `xfsScatterWrite( s0, s1, s2 )` (`SCATTER_INPUT_WRITE`, `platform/api/scene.ts`), which keeps only its pass's; the S1 and S2 passes are marked by `XFS_SCATTER_S1` and `XFS_SCATTER_S2`. An occluder writes zero to every target, so its three variants share one program. `variantOf` became `variantsOf`, and the lighting stage compiles each variant in a step of its own. The 36 bytes per pixel are unchanged.
- **S1 and S2 carry no light.** The skin, the face decals and the plate write S1 and S2 before the light (`scatterUnlitWrite`, placed before `#include <lights_physical_fragment>`). For the plate it goes after the colour-shifting tint, and its residual's later discard never fires on a fragment that passed the coverage test (its alpha is at least the coverage, which is at least 0.001). Without this the split doubled the driver threads' link work: S1 and S2 compiled as slowly as S0 (13–14 s each for the plate under the creator rig), and the creator setup's programs stage took 25 s instead of 17 s. Now a skin S1 variant compiles in 4–13 ms.
- **The layered bake** draws the layer once per accumulation target and the resolve once per kept map. Each list of programs shares its uniforms, the accumulation targets are cleared instead of drawn, and each target's framebuffer is still checked once (PREV-75). `LayeredHandle.target` became `maps`, a pair of targets.
- **The makeup composite** draws each layer into each accumulation target in turn, then the resolve into each merged target, with one shared set of uniforms per pass. Its textures and its `stats` (one per layer, as before) are unchanged.
- **Joint indices are floats** (`floatJointIndices`, `materials/render/skin.ts`), converted where the core and detail loaders restore the skin weights; the rigid binder and the eyes' rig make them as floats.
- **The warm-up's lone pieces went** (`drawsMultiTarget`): nothing builds a long shader at a draw now, so pieces only start small and double.
- **`measure.ts`** gates a frame gap of 100 ms (was 500), records a kept profile's session (`G2_WARM=1`, which first puts the V and setup back), traces several switches with light categories (`G2_TRACE=all`, `G2_TRACE_CATEGORIES`) and runs a subset (`G2_SWITCHES`). **`scene-parity.ts`** waits for a setup's preparation before a capture: since 4a-v-b a setup never drawn is prepared with the one before still drawn, and the first capture of this chunk caught the studio setup under "Lighting: getting ready…".

**Gates.**

- **No multi-output program** (`tests/single-output-programs.test.ts`): no shader in `src/` declares an output past location 0 or uses `gl_FragData[n]`, and no render target has more than one colour attachment.
- **Joint indices** (`tests/skin.test.ts`): integer sets become floats with the same values; floats and weights are left alone.
- **Shader text** (`tests/skin-material.test.ts`, `tests/face-decal-material.test.ts`, `tests/plate-blend.test.ts`, `tests/shader-assembly.test.ts`): each material writes through the macro, S1 and S2 before the light (for the plate, after the tint), and every scatter variant assembles with one output.
- **Bake and composite** (`tests/layered-material.test.ts`, `tests/plate-blend.test.ts`, `tests/scene-feature-renderers.test.ts`): five bake programs with one output each, eight framebuffer checks, and the composite's draws and seven compiled passes.
- **T2** (`tests/webgl-scene-preparation.test.ts`, new gate): with KHR_parallel_shader_compile, no presentation gap over 100 ms from a cold V's want to its show, or while a setup never drawn is prepared on the shown V; with or without the extension, none during either warm-up.
- **The real-GPU probes** keep their parity: the skin scatter against its CPU reference, the composite against the export's bytes, the layered bake against its CPU twin.

**Results** (23–24 October 2026; RTX 4070, ANGLE D3D11, headless Chrome 155; synthetic runs under the 3 GB guard).

| T2 gate (synthetic heads, with the extension) | Before (4a-v-b) | After |
|---|---|---|
| Cold V: longest gap between presented frames, want to show | 13.9 s (warm-up) | 19.4 ms (warm-up 18.2 ms) |
| Setup on the shown V: longest gap while prepared | 4.0 s | 18.7 ms |
| Cold V: want to first presented frame; setup: change to takeover | 30.0 s; 7.4 s | 25–27 s; 5.2–5.3 s |
| Without the extension: longest gap in either warm-up | 13.3 s; 3.9 s | 18 ms; 18 ms (its page tasks stay long, as before) |

The preparation probe passes 15 of 15, and the other WebGL probes pass too: skin scatter, plate composite, display, renderer device, scene host, scene dispose, studio lighting, body, clothing, eye, contact shadow, choice preview (peaks 0.9–2.0 GB).

**G1 parity** (as §8: `tools/scene-parity.ts`, real V, both presets, 1K and 2K, isolated server, against G1's base captures of `72369156`): **20 of 20 pass**, 15 identical and 5 within noise (one step on 1–6 pixels; worst `board3-studio-2048`, 6 of 460,192, 0.0013 %). Captures in the ignored `evidence/screenshots/043-p4a5c/`. The chunk's earlier commits gave 17 and 19 identical, the rest within noise.

**G2 on real data** (`measure.ts`, a fresh profile per run, isolated server with scratch caches). Before is `a0091847` (one traced run here; 4a-v-b's own runs agree). After is the last commit of this chunk, two runs, the first traced. The summaries and samples are in the ignored `generated/g2c/`.

| Switch | Before | After (runs 1, 2) |
|---|---|---|
| Builds on the GPU process's main thread: A, B, C | 33 (3.0 s), 53 (19.6 s), 56 (22.9 s) | 0, 0, 0 |
| **A: body.** Longest frame gap during preparation | 1.8 s | 67 ms, 50 ms |
| A: from the programs stage to the first presented frame | 4.9 s | 2.2 s, 2.2 s |
| A: tasks of 50 ms or more during preparation | 1 (55 ms, details) | 1 (66 ms: see below), 0 |
| **B: lighting.** Longest frame gap | 15.3 s | 24 ms, 24 ms |
| B: request to the new setup's first frame | 37.9 s | 18.1 s, 18.0 s |
| **C: body and lighting.** Longest frame gap | 17.1 s | 19 ms, 20 ms |
| C: request to first presented frame | 43.7 s | 21.5 s, 21.5 s |
| B and C: tasks of 50 ms or more | 0 | 0 |
| Links in any first shown frame; tasks of 50 ms or more in the second after it | 0; 0 | 0; 0 |
| Programs linked during preparation: A, B, C | 28, 53, 56 | 42, 75, 80 |
| Link-time pixel shader builds on the driver's threads: B, C | 83 s, 94 s of CPU | 82 s, 97 s |

**Verdict: B and C pass every gate in both runs; A passes in run 2.** In run 1 A had one page task of 66 ms just before its warm-up, where Three builds the head's morph-target texture at its first draw in the first warm-up piece (a CPU profile of the same task: 77 % in Three's morph-target update, over half of that the `texSubImage3D` upload). It is not a shader build and not new: On the base it came in 2 of 5 A runs (70 and 72 ms); after, in 7 of 12 (50–102 ms, twice holding one frame for 101–104 ms). It is 4a-vi's item below. A's `details` stage can also give a task of 50–62 ms (the skin's underlay read back), as before.

**A kept profile** (the brief's question, asked before any 4a-v-b number was used). Chrome's program cache keeps the draw-time builds: on the base, a second session on the same profile built 1 of the body switch's 33 (a 43 ms vertex shader), and a third built none of the creator rig's 56. So the gaps were a first-session cost: a new install, a browser or driver update, or a cleared cache. The base's warm sessions still failed G2 on page tasks (one of 73 ms, a frame gap of 102–123 ms). After the change a kept profile gives A 6.6 s, B 9.5 s, frame gaps of 23–79 ms and no task of 50 ms or more.

**What it costs.**

- **Drawing.** The scatter's input is drawn three times a frame. Measured with the verification hooks (`xfStudioCreatorRig.frameMs` and `scatterPassMs`, the minimum of six alternations, as [the skin reference §11.5](../../research/materials/shader-skin.md#115-performance)) at 466 × 688 and 806 × 1188 drawing-buffer pixels: the scatter's passes 0.75 → 2.2 ms, a frame with the scatter 2.5 → 4.1–4.2 ms (without it 1.3 ms, unchanged). The cost is draw calls, not pixels (the default V draws 28 materials in each pass), so it doesn't grow with the canvas. It is paid only by drawn frames: on change, and continuously while the idle plays.
- **Programs.** 14–24 more per switch (S1 and S2 variants), cheap to link since they carry no light: B's link work on the driver's threads is as before.
- **Joint data.** Twice the bytes for joint indices (16 rather than 8 per vertex and set).

**Decisions and caveats.**

- **Three passes rather than a lit pass and an unlit two-target pass.** Any program with two outputs is built again at its first draw, cheap or not. One output per program is a rule a test can hold.
- **Each pass redraws the whole input scene against a cleared depth buffer** rather than testing S1 and S2 against S0's depth. Reusing S0's depth would drop the occluders' draws, but it relies on two programs computing the same depth to the last bit. Three doesn't declare `invariant gl_Position`, and the unlit programs keep fewer varyings.
- **Program count.** The occluders share one program across passes. The extra skin and decal programs are cheap to link and are compiled ahead in the `programs` stage like the rest.

**What 4a-vi needed from this** (built in §13, except the scatter's draw cost).

- **The head's morph-target texture** was the last page task over 50 ms in G2 (A, about half the cold runs). Three builds and uploads it whole at a mesh's first draw and offers no other way to make it: a step of its own, with the texture built ahead or uploaded in layers, would need to reach into Three.
- **The knowledge page on program linking in WebGL** should take this chunk's findings too:
  - ANGLE's draw-time builds for several outputs and for integer vertex inputs, both on the GPU process's main thread;
  - Chrome's program cache keeping them across sessions;
  - unreachable lighting compiled out of S1 and S2 (`scatterUnlitWrite`).
- **The scatter's draw cost** (about 1.4 ms a frame) could fall by drawing S1 and S2 only for skin and decals against S0's depth (with an invariant position), or with fewer, merged draws. It is noted on the performance track, not needed for a gate.

## 13. Chunk 4a-vi: routing by named view, editors per view, the S2 gates (built)

The last chunk of phase 4a. After it come G3 (the gate table on real data, §5), a final review and the merge.

**What changed.**

- **View actions are routed by the view they name** (`preview/view-routes.ts`). The application asks the scene runtime owner which resident runtime holds the named view, and how (`heads.runtimes.route(view)`, `StudioApplication` `runtimes`), and sends camera, preview and motion actions there with that reach:
  - `drawn`: the shown runtime draws the view, and shows the scene's current V and body;
  - `scene`: the same, through another view of the scene;
  - `warm`: a hidden resident runtime holds the scene's current V and body;
  - `loading`: none does, and one is being built or prepared for that scene;
  - `absent`: none does. With `loading` and `absent` the shown runtime's services take graph edits only.

  Nothing reaches the shown runtime's device for a view it doesn't draw. A head made before a change of the scene's V or body (the female head while the male one builds) is `drawn` no more: the view is `loading`, and its preview settings are checked against the stored ranges, not the old head's. The owner reads only contexts it already made, so routing never makes a V's context.
- **What each family does** (decided in this chunk):

  | Reach | Camera | Preview: eye shape, details, hair; light and display settings | Motion |
  |---|---|---|---|
  | `drawn` | the device frames it | checked against the head, applied | applied |
  | `scene` | camera node only, unless the view shares the drawn view's camera node | checked against the shown head, applied | applied (one scene, one motion) |
  | `warm` | camera node only | checked against the warm head, applied; it follows hidden and shows it when shown | refused (`not_ready`) |
  | `loading`, `absent` | camera node only | checked against the stored ranges only, applied | refused (`not_ready`) |

  - **Camera:** framing (Front view, Whole body, the creator cameras, the lens) is computed by a device from its live camera, lens and subject. A view not drawn has none to compute with, so framing is refused plainly ("That 3D view isn't shown now. Show it first.", or "That view's V is still loading."). A restore, an orbit step, Back and Forward edit the view's camera node, and the runtime that draws the view later starts there (decision D3). No device moved for such an edit, so it is published as unapplied (`cameraJump` and `cameraMoved` take `applied: false`), and every device drawing through that camera node applies it: a drawn view sharing the hidden view's camera moves with it, and never writes its old pose back when it is hidden.
  - **Preview settings** are graph edits a runtime follows. A resident head of the view's V and body checks them against what it offers. With none resident, the stored ranges are checked, and the head built later shows its own fallback while the node keeps the choice (§10).
  - **Motion** is what a device plays now (the idle's clip and phase, a pose loading, the blink), and its checks read the device. A hidden runtime's motion is released until it is shown, when it restores the scene node's motion. Applying an action to it would bypass those checks, so it is refused plainly. One scene has one motion, so any view of the drawn scene acts on the shown runtime.
- **A device follows the view it draws.** `PreviewActions` takes a view (`view()`), and `draw(view)` draws another view of the same scene (its lights, display and tools at once) or marks the device hidden (`draw(null)`). The head is made for the drawn view, shown for it (`show(view)`), and redrawn for another view of its scene (`draw(view)`: the camera to the old view's node, the motion handed over, then the new view's). `heads.show(view)` of a view whose scene the shown head already draws redraws that head. `graphMotionScene` reads the drawn view's scene.
- **Removed:** `NOT_DRAWN`, `DRAWN_CHECKS`, `drawsScene` and `MotionScene.draws`; the `MAIN_VIEW` seeds in `trusted-preview-services.ts` (the head names its view) and in the head's preparation (the setups of the other views of the drawn view's scene); `scenes.drawn` in the owner's port (it takes the drawn view and `of(view)`); `preview/browser/scene-surfaces.ts`; the head's own mount of the on-head editor.
- **Loaders ready per V.** A save is ready to load on the V a request names once a head shows that V (`heads.showing(character)`; `savedVReady(character)`), and its answer is that head's. The character-preset loader already went through `character.setSource`.
- **One edited look until phase 2.** The look editor edits one document, the drawn scene's look, and the editors' preview source rasters it. `heads.show(view)` of a view whose scene shows another look is refused with a plain reason ("That view shows a different look from the one you're editing, and two looks can't be edited side by side yet."), with nothing changed (`editors.refusal(view)`, `ANOTHER_LOOK`). A view of a scene showing the same look is drawn as before. Chosen over switching the document on takeover (Sol's option a): the drawn view changes when `show` is called, but the head changes only once the new one is prepared, so switching the document would need a second notion of the drawn view, or a window where the document and the head on screen disagree. Phase 2 gives each view its own document, and lifts the refusal.
- **Editors per view** (`preview/browser/scene-editors.ts`, `createSceneEditors`). It registers the composed layered surfaces and wires the one the look editor edits, as `scene-surfaces.ts` did. It builds the on-head and UV editors' hooks that the root used to build. The runtime owner mounts the on-head editor on the head shown for the drawn view (`editors.mount(head, view)`), after the head connected its surface, and unmounts it before the head is hidden or redrawn for another view (the viewport device's new `unmountSurface` settles an open gesture). The editor names the look that view's scene shows, through the input layer's naming for the view (`naming`: the resolution of the view's panel, which only the input layer reads). It follows the head's Surface controls tool (`surfaceControls`, `onSurfaceControls`) and attaches the surface's outline while mounted. The UV editor stays a panel until view graph P6: its hooks name the drawn view's look. **UI-boundary exception 17 is removed.**
- **The S2 gate table as a T2 test** (`tests/webgl-scene-runtimes.test.ts`, page `tests/webgl-scene-runtimes-probe-page.ts`, renamed from the preparation probe so each row is read from the one page that covers it). The page gained:
  - **6b:** the superseding body switch, a build coming back after it was superseded (its last step can't be stopped), eviction, and a V in a scene of its own opened and closed. These moved from the renderer device probe's section 7, which is gone.
  - **6c:** the morph-target texture, below.
  - **The single-output rule over the whole run.** The context records every fragment shader, framebuffer attachment and draw-buffer list it is given (`tests/fixtures/single-output.ts`).
- **Sol's review of 4a-vi** (six findings, fixed):
  1. Routing accepted a stale head: the shown-head shortcut checked only the scene, so during a female-to-male build it named the female runtime `drawn`, and a pending eye shape valid for the male head was refused against hers. It now matches the scene, V and body (above).
  2. Camera edits could be lost: node-only restores and orbit steps were published as applied, so a drawn device sharing the camera never moved and wrote its old pose back when hidden (FOV 45 back to 30). They are published unapplied and applied by every device drawing through the camera (above).
  3. Mounting per view didn't switch the edited document: refused until phase 2 (above).
  4. Finding Three's morph map by wrapping `WeakMap.prototype.get` wasn't safe under re-entrancy (renderer B drawing the same geometry inside A's draw gave both B's map). Replaced by the Three patch (above); the wrapping and its fallback are deleted.
  5. The single-output gate's contact-shadow pass never ran (no light flagged). A light is flagged now; the test asserts the prepass drew and checks the shaders and attachments it recorded.
  6. The knowledge page said Chrome on Windows always offers KHR_parallel_shader_compile; it now claims only the tested configuration.
- **Sol's two gate findings (4a-v-c review), fixed.**
  - (a) The presentation-gap gate counts the interval that ends at the takeover (`tools/frame-gaps.ts`, used by `measure.ts`). Samples at 0, 16 and 1,016 ms with the takeover at 1,016 ms now fail (`tests/frame-gaps.test.ts`).
  - (b) The single-output gate (`tests/single-output-programs.test.ts`) draws the passes that once wrote several targets (the skin scatter's input, the makeup composite, the layered bake) and the frame's other targets (contact shadows, the scene-linear display) through a real Three renderer over a recording context (`tests/fixtures/recording-gl.ts`, shared with the shader-assembly test). It checks the assembled fragment shaders' outputs, the framebuffer attachments and the draw-buffer lists. The source scan reads whole files, so a multiline `layout` is caught, and refuses any `count` option in a module that makes a render target. Negative fixtures cover both bypasses, in the recording and in the scan.
- **The morph-target texture is made ahead** (`platform/scene/morph-textures.ts`). Three builds a geometry's morph targets into one float array texture at the first draw of a mesh that uses it, filled and uploaded whole in the draw's task, and keeps it in a map private to the renderer. The preparation's textures stage now makes the same texture ahead, as Three fills it, a few layers per step within the step budget. Each batch of layers is uploaded on its own (`DataArrayTexture.layerUpdates`, behind the GPU gate). The finished texture is registered with the renderer as Three registers its own, so the first draw finds it ready. **Three is patched for it** (`authoring/patches/three@0.186.0.patch`, Bun's `patchedDependencies`): each renderer exposes its context's morph textures as `xfsMorphTextures` (`get(geometry)`, `set(geometry, count, texture, size)`), and a restored context makes new ones, so steps begun before a loss hand nothing over. The first runtime on a renderer is prepared ahead too: nothing has to be drawn first. What the patch changes, why, and how to re-apply it on a Three upgrade: [toolchain](../../docs/toolchain.md#the-threejs-patch). Without it Three builds its own at the draw, as before.
- **A knowledge page:** [WebGL program linking and draw-time builds in Chrome on Windows](../../knowledge/webgl-program-linking.md). ANGLE, Chromium and KHR_parallel_shader_compile are credited.

**Gates.**

- **T1:** `tests/view-routes.test.ts` (an action naming a hidden view never touches the shown runtime: framing and motion refused, neither device moved; a restore, Back and an orbit step edit the hidden view's camera node only; preview settings checked against the warm head and applied to its view; the stored ranges for a view whose V is loading or absent; a device's own reach without a router; a device drawn for another view of its scene). The owner's routing and per-view mounting (`tests/browser-scene-heads.test.ts`, two new tests). `tests/scene-editors.test.ts` (3, with the refusal of a view showing another look; the owner's refusal of `show(view)` in `tests/browser-scene-heads.test.ts`). Sol's reproductions: a pending eye shape valid for the male head checked against the stored ranges while he builds (`tests/browser-scene-heads.test.ts`); a restore and an orbit step naming a hidden view that shares the drawn view's camera, then the drawn head hidden, keeping FOV 45 (`tests/view-routes.test.ts`). `tests/morph-textures.test.ts` (4: the renderer's morph textures through the patch, the first one made ahead too, and a lost context; a texture byte for byte Three's in small steps whose draw builds nothing; stopping part-way; two renderers drawing one geometry, one inside the other's draw, and a texture made ahead through one, each keeping its own). `tests/frame-gaps.test.ts` (2). `tests/single-output-programs.test.ts` (4, the contact prepass drawn for a flagged light). Saved-V readiness per V (`tests/studio-file-operations.test.ts`).
- **T2, the S2 gate table** (`tests/webgl-scene-runtimes.test.ts`, synthetic heads, with and without KHR_parallel_shader_compile).
- **The boundary and ratchet tests** follow the root: `createSceneEditors` registers the surfaces, the root names no feature and reads the resolver only as the input layer does.

**Results** (24 October 2026; RTX 4070, ANGLE D3D11, headless Chrome 155, a fresh profile per run; under the 3 GB guard).

| S2 row (T2, with the extension) | Result |
|---|---|
| Warm switch, want to first presented frame (≤ 100 ms) | 4.1–5.1 ms (8 switches) |
| Cancel (≤ 100 ms): a preparation superseded while it compiles; a body switch's build superseded in its core | 5.0 ms; 0.3 ms |
| No stray frames | the cold V 0 frames before shown, the cancelled V 0, the late build 0; the shown V's pixels unchanged throughout |
| No late result | the build that came back after it was superseded was disposed (`AbortError`) and never shown |
| Last choice | female, male, then female 150 ms later: female shown, the male build stopped in its core and never built |
| No first-draw stall | the cold V's first shown frame links 0 programs and makes 0; the longest presentation gap 19 ms (cold V) and 19 ms (a setup on the shown V); no task of 50 ms or more |
| Memory returned | a V in a scene of its own, opened (+48 textures, +33 programs) and closed: GPU objects and Three's programs as before; closing everything: at the baseline |
| One output | 528 fragment shaders and 591 framebuffer attachments over the run: none with a second output or attachment, no draw-buffer list of two |

The page passes its 22 tests in the last run, after Sol's review fixes (peak 2.0 GB). Without the extension, warm switches took 3.7–5.7 ms and the cancels 0.1 and 0.2 ms; its page tasks stay long (recorded, not gated), as before.

**The morph-target texture** (page step 6c: a geometry of the real head's morph size, 6,800 vertices and 105 targets of position and normal deltas, 22.8 MB of float texels). Since the Three patch it is measured as a first load: no morph mesh drawn on the renderer before (the synthetic heads have none), the program compiled ahead, the texture made ahead through the patch and drawn; then its twin drawn as Three builds it:

| | With the extension | Without |
|---|---|---|
| Made ahead, the first on the renderer: steps, longest step, wall time paced over frames | 9 steps, 8.0 ms, 0.75 s | 9, 8.0 ms, 0.75 s |
| The first draw (the program's first use; the texture found ready, nothing built) | 10.6 ms | 10.8 ms |
| Three's own build of the twin, inside its draw (50–102 ms over the earlier runs) | 49.5 ms | 53.7 ms |
| Byte for byte Three's | yes | yes |
| Tasks of 50 ms or more from the first step to the first draw | 0 | 0 |

Before the patch the first runtime on a renderer could make nothing ahead (the map was found only from a morph draw), so the first load paid Three's whole build inside a draw; it now pays the steps above, inside the preparation's textures stage.

The real head's figure in G2 was 50–102 ms (§12); G3 measures it again on real data.

| Other runs | Result |
|---|---|
| Targeted tests: preview, motion, view, scene, profiles, camera, pose, lighting, application, presentation, idle, blink, startup, head, character, history, workspace, input, action, catalogue, panel, expression, boundary, audit, editor, surface, gesture, file, single-output, shader and frame tests | 178 files (morph, preparation, residency and link-pacing tests added): 1,418 pass, 12 skip (real-game oracles), 0 fail (peak 1.6 GB) |
| After Sol's review fixes: the targeted families again (preview, view, scene, runtime, head, morph, single-output, frame, editor, camera, profiles, motion, lighting, startup, boundary, audit, surface, gesture, residency, preparation, application, link, shader) | 100 files: 825 pass, 3 skip, 0 fail (peak 1.5 GB) |
| WebGL probes: renderer device (section 7 moved out), scene dispose, scene host; after the fixes also body and clothing (morph meshes, now made ahead on the first runtime) | 7, 4, 7: all pass (peak 1.2 GB); body and clothing 13: all pass (peak 1.5 GB) |
| `bun run check` | passes |

**Decisions and caveats.**

- **Refuse rather than apply on a hidden runtime, for framing and motion.** Applying would have meant computing a camera from a lens and subject no one sees, or storing motion past the checks that read what a device plays. Both are one show away, and refusing names the view.
- **Routing reads no context it hasn't made.** A V whose context was never made has no head, so it can't be warm.
- **The morph texture goes to Three through a patch, not around it.** Three r186 exposes no way to hand a renderer a morph texture. A small patch pinned to `three@0.186.0` (Bun's `patchedDependencies`) gives each renderer `xfsMorphTextures`, its context's own, which `set` fills as Three's `update` would; it replaced finding Three's map by wrapping `WeakMap.prototype.get` during a draw (decided by the maintainer after Sol's review). The patch is two hunks in `build/three.module.js`; [toolchain](../../docs/toolchain.md#the-threejs-patch) says how to re-apply it. `tests/morph-textures.test.ts` fails without it and holds the bytes against Three's own build. three.js is MIT, which asks for no notice of modification, so the community credits are unchanged.
- **The UV editor names the drawn view's look.** It is a panel until view graph P6. The on-head editor names the look of the view it is mounted for.
- **The ratchet's scene-host importers** (`tests/view-graph-audit.test.ts`) are unchanged: the plan's row expected the list to shrink, but none of its four importers moved in this chunk. The device's runtimes are still scene hosts by type.
- **Not changed here:** face shadows and skin scatter switches on the shown V still recompile inside its next frame (§11, 4a-v-b); the first runtime's room prefilter (§11); the scatter's draw cost (§12).
- **No UI change.** Nothing visible changed: a view other than the main one can't be drawn until phase 2's tabs, and the refusals name views the UI doesn't offer yet. No UI review is needed for this chunk.

**What's left before the merge.**

1. **G3** (§5): the S2 gate table on real data, warm cache and then a fresh profile, with the whole-body part, by the coordinator. The presentation-gap gate now counts the interval ending at the takeover, and the morph texture made ahead (the first runtime's too, since the patch) should remove A's last page task over 50 ms.
2. The coordinator's merge (Sol's review is done; its six findings are fixed above).

## 14. G3: the S2 gate table and parity on real data (run 24 October 2026)

The last gate before phase 4a merges (§5). It is a measurement, with no change to the product. Offline browser measurements on one machine, not game evidence. Raw outputs are in the ignored `generated/g3/` (run summaries, per-frame samples) and `projects/xf-studio/authoring/evidence/screenshots/043-g3/` (the parity frames).

| Item | Value |
|---|---|
| GPU, browser | RTX 4070 (driver 610.88), ANGLE D3D11, headless Chrome 155, the game not running |
| After | `claude/profiles-4a` at `9ff40365`; the reruns after the final fixes (§15) at `a3d8653f` |
| Base | `origin/main` at `d815f67d` |
| Setup | Each build in its own worktree with its own isolated server (own port, own data folder and caches, a read-only copy of the host's settings), never port 4317 or 4331. Servers under `memory_guard.py --limit 5`; every Chrome run under `--limit 5` |
| Harness | `tools/scene-parity.ts` and `measure.ts` here, which gained the G3 rows below (`G3_ROWS=1`, `G3_PART=memory`) |

### Parity

`tools/scene-parity.ts` with the rule of §8 (at most one channel step on fewer than 0.01 % of the pixels), 20 frames per capture: five looks, both lighting presets, 1K and 2K. Two base captures from the base build, three after captures from this branch, each compared with the nearest of the two bases.

| Capture | Identical | Within noise | Outside the rule | Worst frame |
|---|---|---|---|---|
| `base-2` against `base-1` (same-build noise) | 19 | 1 | 0 | 3 pixels (0.0007 %), step 1 |
| `after-2` | 14 | 6 | 0 | 1 pixel (0.0002 %), step 1 |
| `after-3` | 16 | 4 | 0 | 1 pixel (0.0002 %), step 1 |
| `after` (the first, on a fresh server) | 15 | 4 | **1** | `bare-creator-1024`: 99.5 % of the pixels, step up to 32 |
| `final` (§15: a fresh server, the settle step fixed, at `a3d8653f`) | 15 | 5 | 0 | 1 pixel (0.0002 %), step 1 |

The outlier in `after` was the first creator-lighting frame of a capture on a freshly started server, drawn with the neutral grade instead of the creator grade (less saturated, otherwise the same; the 2K frame after it matched). The cause was the harness's settle step. The stage asks the host for the creator grade only once the creator setup is drawn, and on a fresh page that setup is first staged and prepared on the shown V. The settle step read the grade's phase before the takeover, found it `idle` (its check only refused `loading`) and moved on, so a frame could be kept before the grade arrived. The settle step now waits for the asked setup to be drawn (no preparation, nothing staged), then for the grade to be `ready`, then for the frames (§15). The rerun on a fresh server (the tool starts its own, with its Chrome, under one guard of 8 GB; peak 5.4 GB), against the same two bases, is within the rule on every frame, `bare-creator-1024` identical. **Verdict: pass.**

### The S2 gate table on real data

`measure.ts` on the isolated server, three runs: two with a fresh Chrome profile (a cold program cache) and one on the second run's kept profile (`G2_WARM=1`). Each run is the G2 switches A (body: the masculine default V, never drawn on the page), B (lighting: the creator setup on the shown V) and C (body and lighting), then the G3 rows:

- **D, warm switches:** eight body switches between the two bodies, both resident (shown and warm), want to the first presented frame.
- **E, cancel:** the context is lost and restored first (it drops the warm runtime, D2), so the other body is asked for from nothing. The body is asked for, and 150 ms later the shown body is chosen again. The idle is off and a hash of the canvas is taken on every frame, so a frame drawn for anything not shown is a change. A 5 s tail would show a late result.
- **F, last choice:** after the same drop, male, female and male again 120 ms apart.

| S2 row | Run 1 (cold) | Run 2 (cold) | Run 3 (kept profile) | Gate |
|---|---|---|---|---|
| A body: want to first presented frame | 8.7 s | 9.3 s | 2.5 s | progress, no gate |
| B lighting: change to takeover | 18.2 s | 17.4 s | took over in 14 ms with nothing to prepare (see below) | progress, no gate |
| C body and lighting | 21.4 s | 20.5 s | 10.3 s | progress, no gate |
| **Warm switch** (D, 8 switches per run): want to first presented frame | 18.8 to 29.5 ms | 18.8 to 30.1 ms | 18.4 to 25.5 ms | ≤ 100 ms: **pass** |
| D: want to the show | 6.9 to 14.4 ms | 7.2 to 16.1 ms | 7.2 to 14.2 ms | |
| **Cancel** (E): the cancel to the preparation being over, with the preparation in its core and build steps | 8.1 ms | 5.7 ms | 4.5 ms | ≤ 100 ms: **pass** (frame resolution; the synthetic gate times it exactly) |
| **No stray frames** (E, the whole window of about 7 s; F, until the takeover): frames drawn by the shown runtime, changes to the canvas | 0 and 0 (E); 0 canvas changes (F) | the same | the same | **pass** |
| **No late result shown** (E and F, a 5 s tail after the preparation ended) | the shown V never changed | the same | the same | **pass** |
| **Last choice wins** (F): the V shown | only the final choice (male), 4.75 s after the first | 4.77 s | 4.75 s | **pass**: the shown keys were female, then male once, never an interim |
| **No task of 50 ms or more** (A, B, C, D, E, F; the Long Tasks API) | none | none | none | **pass** |
| **No link in the first shown frame**: A, B, C | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | **pass** |
| No link in the first shown frame: D, the warm switches | 2 programs on each of the 4 male shows (0 on the 4 female ones) | the same | 0 of 8 | **fail** in these cold runs (below); 0 of 8 in both reruns after §15 |
| **No presentation gap over 100 ms**: longest gap during A, B, C, and over D | 52.3, 27.5, 18.9 ms; D 18.8 ms | 66.8, 26.8, 19.0 ms; D 20.3 ms | 18.9, 14.1, 19.4 ms; D 19.0 ms | ≤ 100 ms: **pass** |
| Progress shown (the pane said something on every frame from 150 ms in; the fraction only grew) | longest silent stretch 0 ms | 0 ms | 0 ms | **pass** |
| Programs linked in A, B, C before the show | 42, 75, 80 | 42, 75, 80 | 42, 0, 80 | |
| Duration of the run | 154 s | 152 s | 736 s (600 s of it is B, below) | |
| Peak memory (the guard's peak for Chrome and the harness, limit 5 GB) | 4.1 GB | 4.2 GB | 4.2 GB | |

**The row that failed, and why.** On each warm switch to the masculine V in the cold-profile runs, two programs were linked in the first shown frame: `LineBasicMaterial` and `PointsMaterial`, the on-head editor's guides (the first use waited 1.0 to 1.3 ms). No frame was late (the longest gap in D was 20 ms), but the row is literal. The cause, found for §15:

- Three keys even an unlit material's program on the scene's light counts, so each lighting setup has its own variant of the guides' programs.
- The editor made its own guide materials on every mount and disposed them on every unmount, and Three frees a program when the last material holding it is disposed.
- The masculine V was prepared hidden under the studio setup (A), with the guides' stand-ins compiled for it. The creator setup was then prepared on him while shown (B), and that compiles what is drawn: the mounted editor's own materials, not the stand-ins. Hidden, his editor took the creator variants with it, so each show under the creator setup linked them again.
- The feminine V was prepared hidden under the creator setup (C), so her stand-ins held those variants. The kept-profile run started under the creator setup, so neither body linked anything.

The editor now draws with the head's own guide materials, the ones its stand-ins are compiled with, so every variant stays linked while the head lives (§15). The synthetic gate reproduces the sequence (a setup prepared on the shown V, then that V hidden and shown again) and fails without the fix.

**B in the kept-profile run.** The creator setup took over in 14 ms with nothing to prepare: no program linked, no preparation. That profile had restored the creator setup at load, so its programs were already in the page. `measure.ts` then ended a lighting run only after it had seen a preparation, so it waited out its 600 s limit and marked the run "never took over" (the first presented frame was 19.7 ms). It now ends a lighting run at the takeover, whether or not a preparation ran (§15). The kept-profile rerun's B took over in 20 ms, and the run took 71 s.

**Reruns after the final fixes** (§15, at `a3d8653f`; the same isolated server setup, the server under `--limit 5`, each Chrome run under `--limit 5`). Two runs with a fresh profile, all rows; then a third on the second run's kept profile (`G2_WARM=1`), A to C only, for the lighting run's end:

| S2 row | Rerun 1 (cold) | Rerun 2 (cold) | Kept profile | Gate |
|---|---|---|---|---|
| A body: want to first presented frame | 12.6 s | 8.3 s | 2.1 s | progress, no gate |
| B lighting: change to takeover | 18.2 s | 17.3 s | took over in 20 ms with nothing to prepare, and the run ended there | progress, no gate |
| C body and lighting | 20.6 s | 20.7 s | 11.6 s | progress, no gate |
| **Warm switch** (D, 8 switches): want to first presented frame | 18.4 to 25.5 ms | 18.1 to 26.9 ms | | ≤ 100 ms: **pass** |
| D: want to the show | 8.2 to 15.8 ms | 7.6 to 17.3 ms | | |
| **No link in the first shown frame**: A, B, C; D | 0, 0, 0; 0 of 8 | 0, 0, 0; 0 of 8 | 0, 0, 0 | **pass** |
| **Cancel** (E) | 4.0 ms | 16.6 ms | | ≤ 100 ms: **pass** |
| **No stray frames**, **no late result**, **last choice** (E, F) | E: 0 frames by the shown runtime, 0 canvas changes; F: only the final male, at 4.77 s | the same; F at 4.80 s | | **pass** |
| **No task of 50 ms or more** | none | none | none | **pass** |
| **No presentation gap over 100 ms**: A, B, C; over D | 61.1, 28.4, 19.2 ms; 25.9 ms | 60.2, 25.7, 20.0 ms; 19.1 ms | | ≤ 100 ms: **pass** |
| Programs linked in A, B, C before the show | 42, 75, 80 | 42, 75, 80 | 42, 0, 80 | |
| Duration of the run | 179 s | 169 s | 71 s (736 s before the fix) | |
| Peak memory (Chrome and the harness) | 4.3 GB | 4.2 GB | 4.0 GB | |

Rerun 1's A (12.6 s) was the first switch on a freshly started server; its details stage waited longer for the host's files. It has no gate.

**Rows `measure.ts` can't drive on real data, and where they are covered.** The synthetic gate `tests/webgl-scene-runtimes.test.ts` covers each:

- a hidden runtime drawing no frame before it is shown, and a cancelled one drawing none (the real-data check above looks at the canvas and the shown runtime's frame count, which a hidden runtime's draw would change, but it can't count a hidden runtime's own draws);
- a build coming back after it was superseded (its last step can't be stopped) and being disposed, never shown;
- eviction, and a V in a scene of its own opened and closed.

Phase 4a has no way to open a second V on the page: a want's key is (scene, V, body), the page has one scene and one V, so the only keys are the two bodies and nothing is ever evicted. Phase 2's tabs add it. The cancel and last-choice rows use a lost and restored context to start from nothing, which is real data but not the path a person takes (a person would ask for a body whose runtime was evicted, or for a second V).

### Memory returned

`G3_PART=memory`: a fresh profile, A, B and C, then ten cycles of a switch to the masculine V and back, four cycles of a studio and creator setup change, 10 s idle, and a lost and restored context. After each step the Chrome processes' private bytes (the GPU process, the page's renderer) and the GPU process's dedicated video memory (Windows' per-process GPU counters), the page's JS heap after a collection, and the live GL objects (created minus deleted, counted by wrapping the context's create and delete calls) were read. Both bodies are resident throughout (the shown one and one warm), which is D2's budget.

| After | GPU process private | GPU dedicated video | Page renderer private | JS heap | Live GL objects: textures / buffers / framebuffers / programs / vertex arrays |
|---|---|---|---|---|---|
| Start (the feminine V alone) | 1,831 MB | 1,164 MB | 704 MB | 299 MB | 144 / 372 / 32 / 104 / 155 |
| A (the masculine V shown, the feminine warm) | 2,691 MB | 1,799 MB | 820 MB | 489 MB | 279 / 754 / 60 / 146 / 300 |
| C (the feminine shown, the masculine warm) | 2,924 MB | 1,900 MB | 745 MB | 510 MB | 301 / 762 / 70 / 299 / 572 |
| 1 body cycle | 2,932 MB | 1,904 MB | 745 MB | 510 MB | 301 / 762 / 70 / 299 / 572 |
| 3, 6 and 9 body cycles | 2,932, 2,926, 2,928 MB | 1,904 MB each | 729, 771, 787 MB | 510 MB | the same, every time |
| 1 and 4 lighting cycles | 2,920, 2,924 MB | 1,891, 1,890 MB | 792, 761 MB | 511 MB | 289 / 762 / 64 / 299 / 572 both times |
| 10 s idle | 2,923 MB | 1,890 MB | 722 MB | 511 MB | the same |
| After a lost and restored context (informational) | 2,006 MB | 1,221 MB | 679 MB | 364 MB | not meaningful (a lost context's objects are never deleted) |

- **Returned.** From the first cycle to the ninth, the GPU process's private bytes moved by 6 MB, its dedicated video memory by 0.2 MB, and the live GL objects not at all. The page's renderer wandered by about 60 MB (729 to 792 MB) with no direction. Each body cycle linked 2 programs (the surface editor's, above) and deleted them again: Three's live program count was flat while the probe's link count rose by 2 per cycle. That was the warm-switch row's cause, fixed in §15. The setup cycles freed 12 textures and 6 framebuffers net, never more.
- **Since §15 a warm runtime holds no frame-sized targets** (the display's scene target, the skin scatter's five and the contact shadows'). The memory part wasn't run again. The reruns' readings with both bodies resident (after C, and the same after D's eight switches) show 292 textures, 62 framebuffers and 4 renderbuffers live, against 301, 70 and 7 in the first runs. The skin scatter's targets alone take 36 bytes a pixel of the pane's drawing buffer (its own evidence), so the saving grows with the pane's size and pixel ratio.
- **What a second whole-body runtime costs** (the evidence D2 said a byte cap would wait for): about 860 MB of the GPU process's private bytes, 635 MB of dedicated video memory, 116 MB in the page's renderer and 190 MB of JS heap, with 135 textures, 382 buffers and 28 framebuffers. A card with 8 GB of video memory holds it comfortably; a 4 GB card is where a byte budget would start to matter.
- **A second V opened and closed** can't be driven on real data (above). The synthetic gate does it (a V in a scene of its own opened, +48 textures and +33 programs, and closed: GL objects and Three's programs as before; closing everything: at the baseline), and 4a-i's disposal gate holds the same after five runtimes. The lost-context row is not a leak test, since a lost context frees everything. It shows only that dropping the warm runtime and rebuilding the shown one lands within 175 MB of the start.

### Verdict

| Part | Verdict |
|---|---|
| 1. Parity | **Pass**: the one neutral-grade frame was the harness's settle race, fixed in §15; the rerun on a fresh server is within the rule on every frame |
| 2. The S2 gate table | **Pass on every row**: the warm-switch link row failed in the first cold runs (the editor's guides); since §15 both cold reruns link nothing in any warm switch, and every other row still passes, with the rows the harness can't drive pointed at the synthetic gate |
| 3. Memory returned | **Pass** for what real data can drive (no growth over ten body cycles and four setup cycles); a second V's open and close is covered by the synthetic gate. Since §15 the warm runtime also lets go of its frame-sized targets |

The tool changes are `measure.ts` (the G3 rows, GL object counts, OS memory; since §15 a lighting run ends at its takeover) and `scene-parity.ts`'s settle step (§15).

## 15. The final review's and G3's fixes (built)

Sol's final review of `9ff40365` answered MERGE AFTER FIXES, with one High, one Medium and one Low finding. G3 (§14) left three more: the warm-switch link row, the parity harness's settle race and the lighting run with nothing to prepare. All six are fixed at the root, each with a gate, and the changed G3 rows were run again on real data (§14).

**What changed.**

1. **A warm head's readiness follows the authored makeup** (High; `browser-head-attachment.ts`, `browser-preview-device.ts`). Sol's sequence: A prepared without makeup, B shown, a layer enabled, A wanted again. `prepared()` read only the scene's own record (the meshes drawn and the lighting), and a warm surface keeps what it was filled with until its show. So A was shown at once, and connecting its surface brought new materials and uploads into the first frame (Sol's probe found 10 shaders still to build). The preview device now says whether a surface not shown holds the layers as they are now (`holdsCurrent`): the tier it would be given, and slot for slot the layer, its mask canvas and its optical maps, which is exactly what connecting it would compare. A head is prepared only while every layered surface holds the makeup as it is now. A stale warm head is filled and prepared again before the show, by the residency's usual path, and the show then brings nothing. The surface shown is live, so the shown head is never stale.
2. **A hidden runtime lets go of its frame-sized targets** (Medium; `scene-host.ts`, `lighting-setup-stage.ts`, `linear-display.ts`, `skin-scatter.ts`, `contact-shadow.ts`), as §2.1's memory policy says. Hidden (`detach`), a runtime releases the display's scene target, the skin scatter's five targets and their shared depth texture, and the contact shadows' target. Its programs stay, and so do its shadow maps (their size is the quality's, not the pane's). Shown, the device sizes it (`resized`, after `attach`), and it allocates the targets the next frame draws into, at the drawing buffer's size, with `WebGLRenderer.initRenderTarget`: the first frame finds them made. A runtime prepared hidden makes them in its warm-up, and its show then finds them already at size. A hidden runtime whose preparation stops (a warm one superseded) lets go of what its warm-up made. The contact shadows' uniforms are shared by every scene, so a release clears them only when they still point at its own target. Recreating a target links nothing: no program depends on a target's size (the T2 gate below).
3. **The composite-abort test has no wall clock** (Low; `tests/scene-feature-renderers.test.ts`). It settles queued work on microtasks, checks the preparation still waits on the links (they never end there), aborts, and checks it is released with the links still unresolved. Measured latency stays in the GPU probes.
4. **The on-head editor draws with the head's own guide materials** (G3's failing row; `surface-editor.ts`, `browser-viewport-device.ts`). The cause is in §14: Three keys an unlit material's program on the scene's light counts, and the editor's per-mount materials took the variants compiled for a setup prepared while it was shown away with them. `surfaceGuideStandIns` now owns the head's guide materials, and its stand-ins are compiled with them. The viewport device mounts the editor with those materials (`createSurfaceEditor`'s `guides`), and the editor never disposes materials it was given. Every variant the guides are ever drawn or compiled with stays linked until the head goes. An editor without them (the tests' own) makes and disposes its own, as before.
5. **The parity harness waits for the look to take effect** (`tools/scene-parity.ts`). Its settle step waits, in the order they arrive: the layers at the preview size; the asked lighting drawn (no preparation, nothing staged, the preset drawn); for the creator preset its grade `ready`; the layers again; then the frames. The scene evidence (verification only) now reports the drawn preset and whether a setup is staged (`lighting`).
6. **A lighting run ends at its takeover** (`measure.ts`). Each sample records the lighting drawn (with `staged:` while a setup waits beside it). A lighting run ends when the asked setup is drawn with nothing staged and no preparation in flight, whether or not a preparation ran, and the analysis takes the takeover from the first sample that draws it.

**Gates.**

- **T1:** `tests/browser-head-attachment.test.ts`, Sol's sequence on the real preview device and makeup stacks: A prepared and shown with the layer off, B shown, the layer enabled and its mask completed. A is no longer prepared and B is. A prepared again holds the layer, drawn, and its show moves no version (no program change, no upload). The layer turned off while A is shown leaves B stale in turn. `tests/surface-guide-materials.test.ts`: an editor given the head's guide materials draws with them on every mount and never disposes them; one without makes and disposes its own; the viewport device mounts each head's editor with that head's materials, the ones its stand-ins compile, which go with the head. The composite-abort test (item 3).
- **T2, the S2 gate table** (`tests/webgl-scene-runtimes.test.ts`). The probe page mounts the real on-head editor on the shown V as production does (stand-ins compiled with the preparation, parts made ahead, the head's materials). Its preparations keep a warm V's placed details, as the head's do, and its readiness port reads the surface as the head's does. It gained:
  - **Warm switches** record the links and programs made from the want to the first presented frame, the first frame's uploads against a later frame's, and, once settled, the frame-sized target pixels each runtime holds and the live GL objects.
  - **3b, newer authored makeup while a V is warm:** B shown and A warm, the layer takes the Glossy finish (a clear coat: new layer programs), then A is wanted. A is no longer prepared, is prepared once, and its first shown frame links nothing with the clear coat applied. Back the other way, B is prepared again in turn.
  - **5b, the editor shown again:** after the lighting setups prepared on the shown V (step 5), the other V is shown and then this one again: its editor is mounted anew, and its first shown frame links nothing.
  - **A row "warm residency"** in the gate table: the hidden runtime holds no frame-sized target, and the GL objects are flat from switch to switch.
- **Each new row fails without its fix.** With the readiness port reading only the scene's record, 3b's first shown frame linked 2 programs and A was shown without a preparation. With the editor given no materials, 5b's linked 2 (`LineBasicMaterial`, `PointsMaterial`: G3's pair).

**Results** (24 October 2026; RTX 4070, ANGLE D3D11, headless Chrome 155, a fresh profile per run).

| T2 (with the extension; without it the same unless said) | Result |
|---|---|
| Warm switch, want to first presented frame (≤ 100 ms) | 19.0–31.4 ms; without the extension 20.2–22.0 ms. The measurement now waits for the runtime's own next frame and the frame after it (before, a runtime that had drawn earlier ended the wait at once: one animation frame, 4.1–5.1 ms in §13). The show itself takes 2.8–3.2 ms, up from 0.6 ms, for the targets' allocation |
| Links and programs made over each warm switch | 0 of 8 switches, with and without the extension |
| A warm switch's first frame's uploads | 16 (female) and 17 (male), the same as a later frame's: what every frame sends (its bones) |
| Frame-sized targets once settled | the shown runtime its display and scatter targets (and contact under the creator rig), the hidden one none, after every switch; GL objects equal from switch to switch |
| 3b: newer makeup while warm | not prepared after the change; 1 preparation; first shown frame 0 links, 0 programs; the clear coat applied; back the other way the same |
| 5b: the editor shown again under a setup prepared while shown | 1 mount, first shown frame 0 links, 0 programs |
| The earlier rows | unchanged: the cancels 5.9 and 0.3 ms; no stray frames, no late result, last choice; the cold V's first frame 0 links; gaps 19 and 19 ms; memory back at the baseline; one output over 562 fragment shaders and 797 attachments |

The page passes its 25 tests (peak 2.0 GB of 3 GB).

| Other runs | Result |
|---|---|
| Targeted tests: lighting, scene, display, scatter, contact, renderer, viewport, surface, preview device, head, runtime, startup, the no-default boundary and the view graph | 45 files: 290 pass, 0 fail |
| WebGL probes: renderer device (A, B, then A byte for byte, with the targets released and made again between), scene host, scene dispose, skin scatter, contact shadow, studio lighting, display, plate composite, eye, body, choice preview, clothing | 12 files, 77 tests: all pass (peak 1.5 GB) |
| `bun run check` | passes |
| G3 on real data, the changed rows only (§14) | the warm-switch row passes in two cold reruns (0 links in 8 switches each, 18.1–26.9 ms); parity on a fresh server within the rule on every frame; a kept-profile lighting run ends at its takeover in 20 ms |

**Decisions and caveats.**

- **Readiness compares, it doesn't count.** The device compares what a surface holds with what connecting it would bring, rather than keeping a revision counter beside every way the layers can change (an edit, a mask or optical maps completing, a tier change). It is the same comparison connecting makes, so the two can't disagree. A mask that completes after a warm head was filled makes it stale again, and the residency prepares it again, up to its attempt limit, before the show.
- **A makeup edit makes a warm head's next show a preparation.** Nothing linked is lost, so it costs the details check, the fill, the compile check and the warm-up, not a cold preparation; an unchanged warm head still swaps at once.
- **Allocation at the show, not in the first frame.** A warm switch has no preparation to allocate in, so the targets are made as the device sizes the shown runtime, in the show's task. On real data the want-to-show time stayed 7.6–17.3 ms (6.9–16.1 ms before).
- **The probe's warm-switch figure is larger, not slower.** It now measures the want to the frame after the runtime's own first frame; the real-data D row measures the same way and is unchanged.

**What's left before the merge.** The coordinator's merge.
