# View graph and Studio modules: design

**Status:** design ready, 27 September 2026; nothing built beyond the ratchet test in `tests/view-graph-audit.test.ts`. It answers three directions for the Studio's shell:

1. Show at least one or two modules beyond eye makeup, to demonstrate how switching between modules works, or whether it needs to be exclusive at all. Some modules are not V-centric (the game map, game assets, world locations).
2. Allow more than one 3D view, configured as a graph. Views reference shared or separate nodes: content, camera, lights, render settings, overlays and editing tools. The example to support: two views of V sharing one camera, each with its own light rig.
3. Derive the viewport's buttons from what that view shows. When eye makeup is hidden, its buttons disappear.

The [architecture contract](architecture-contract.md) and the [feature-module platform](feature-module-platform.md) still govern; this page extends §1, §4 and §5 of the platform. Code paths are relative to `projects/xf-studio/authoring/src/` unless a link says otherwise. Line numbers are at `6ccf3cc`.

## 1. Summary

**The audit in one paragraph.** Today "the 3D view" is one object. `createSceneHost` builds one WebGL context, one `THREE.Scene`, one camera with its orbit controls, one set of lights and one subject (the head rig and the V drawn on it). It exposes all of them as one flat API. Everything above it assumes there is exactly one:

- the viewport device has one head host and one UV host;
- the attachment's state has exactly `head` and `uv`;
- `PreviewActions` stores one camera, one lighting setup and one set of display toggles;
- the workspace stores one `preview` block;
- the head attachment constructs the character context inside the head's lifetime;
- the dock builds each panel once, from a static catalogue;
- the head toolbar hard-codes five buttons, two of which belong to eye makeup.

The feature-renderer layer is the exception. It is already close to multi-view ready: renderers are keyed by factory, the scene port exposes no camera, and draw-order bands are per feature.

**Toolbar verdicts in one line.** Front view and Whole body view are platform camera tools that should apply only to character scenes. Idle is the only reactively derived button. Surface controls and Plate wireframe are eye makeup's tools, hard-coded in the shell; the toolbar shows the wireframe even though the panel and palette keep it behind *Show research tools*. The crumb and the readiness badge read eye makeup's state. Details are in §2.14.

**The model.**

- A workspace-level **view graph** holds five node types:
  - **scene** (what is drawn: a V, a location, an asset);
  - **camera**;
  - **lights** (a light rig, including its exposure);
  - **display** (content filter, stage and resolution);
  - **tools** (overlays and editing controls).
- A **view** references one node of each type. Linking points two views at one node; unlinking copies it.
- One WebGL context and one render loop draw every visible view. A change dirties only the views that reference the changed node. Hidden views draw nothing.
- **Studio modules** own panels, view tools, scene kinds and feature renderers, all keyed by module ID. Modules are **combinable**, not exclusive. Hiding one removes its panels and tools and parks its layout, and leaves its data and exports untouched.
- The placeholders are **Poses** (V-centric, from the [pose library design](../animation/pose-library-design.md)) and **World** (non-V, a `location` scene kind for [world and streaming](../../knowledge/world-and-streaming.md)).

**Plan.** Six phases after this one (P1–P6). P1–P5 take about 17–19 agent-days (§6), and every phase keeps the Studio working.

## 2. Audit: where the code assumes one viewport

### 2.1 Scene host (`platform/scene/scene-host.ts`)

| Line | Assumption | Consequence for more than one view |
|---|---|---|
| 55, 76–96 | `createSceneHost(host)` creates its own canvas and WebGL2 context for one DOM host | A second host is a second context. Browsers share no textures, geometry or programs between contexts. The V's baked details, the makeup canvases and the core head would load twice, and browsers cap live contexts (around 16). |
| 97–98 | One `THREE.Scene` and one `PerspectiveCamera` per host | Camera and content are fused: no two cameras over one scene. |
| 101–109 | One `OrbitControls` and one camera input on the canvas | Input and camera are fused to one canvas. |
| 110–136 | `front()` and `frameBody()` read `host.clientWidth/clientHeight` | Framing depends on the one host's aspect. A shared camera must frame per view aspect. |
| 138–142 | The studio rig and the lighting preset stage are added *into the scene* | Lights are scene state. Two rigs over one subject need a per-draw swap (§3.7). |
| 144, 150–154 | The core head, head rig and character renderer are created per host | The subject is owned by the viewport, so a second view would load a second V. |
| 176–187, 227–231 | Resize, `ResizeObserver` and the device-pixel-ratio watch are bound to the one host | Per view, not per scene. |
| 194–220 | One render scheduler. Each frame advances the rig, updates the one controls, computes clip planes for the one camera, runs `beforeDraw` and calls `lighting.render(camera)` | The loop draws one camera. Motion must advance once per frame however many views draw. |
| 92–94, 359 | Tone mapping, exposure and clear colour are renderer-global | Per-view exposure must be set before each view's draw. |
| 239–244 | Feature renderers get one `lighting()` view | Ambiguous with two rigs; no renderer reads it (grep), so it can go. |
| 253–367 | One flat API mixes camera (`cameraState`, `restoreCamera`, `setFov`, `front`), lights (`setLightAngle`, `setStudioLights`, `setExposure`, `lighting`), subject (`applySavedV`, `setFaceMorphs`, `setHair`, `setBody`, `setPiercings`, `setDetail`, `idle`, `blink`) and display and overlays (`setWire`, `setNormals`, `setStage`) | This is the seam to split: each group becomes a node's port. |
| 110, 166–172, 310–319 | Camera state is stored in neutral head space, with the idle's framing offset added | Correct and worth keeping. A camera node's pose is relative to its scene's subject (§3.1). |

### 2.2 Camera

- `head-camera-input.ts` makes the binding table decide each press, attached to the one canvas (`scene-host.ts:103`). It is per canvas already, so it works per view unchanged.
- `camera-framing.ts` and `camera-navigation.ts` are pure, and `CameraState` (`workspace-state.ts:24`) is plain data. Both are reusable as a node's state.
- `PreviewActions` (`preview-actions.ts:15–21`) routes `camera.front`, `camera.body`, `camera.setFov`, `camera.navigate` and `camera.creatorFraming` to the one `PreviewPort` (`:49–69`), with no view or camera target.

### 2.3 Lighting

- `lighting-preset-stage.ts:36–45` adds the creator rig to the scene. `setPreset` (`:84–103`) rewrites `scene.environment`, `scene.background` and the studio lights' visibility: scene-global state switched in place.
- `studio-light-rig.ts:18–27` adds key, fill and rim to the scene, and `:44` sets `scene.environmentIntensity`.
- The creator rig depends on the **subject**. `savedAppearance.setBodySex` calls `scene.lighting.setBodySex` (`browser-scene-preview-ports.ts:16`), so a rig shared by a feminine and a masculine V must resolve its spot lights per scene (§3.1).
- The presentation's Camera & light panel (`studio-ui/panels/preview.ts:58–216`) edits "the" lighting through `port.authoring.dispatch`, with no view or rig.

### 2.4 Subject and character context

- `attachBrowserHead` (`browser-head-attachment.ts:81`) constructs `CharacterDetailActions` (`:101`), the saved-V, preview and motion services (`:103–105`) and `CharacterContextActions` (`:131–138`) **inside the head load**. The DOM-free domain state (which V, every creator choice) therefore lives and dies with the one GPU scene.
- The application holds one of each: `Services` in `studio-application.ts:95–99`, replaced by `attach` (`:140–145`), with one `previewUnavailable` flag (`:109`, `:482`).
- `studio-startup.ts:115–123` keeps one `previewDevice`, `savedAppearance`, `previewActions`, `motionActions`, `head`, `scene` and `uvEditor` as root-level variables.

### 2.5 Overlays and editing tools

- **Surface controls.** `preview.setSurfaceControls` is a *preview family* (platform) action (`preview-actions.ts:36`, `:216`), but what it toggles is eye makeup's on-head editor (`browser-head-attachment.ts:104`, through `options.setSurfaceControls`).
- **Plate wireframe.** `setWire` fans out to every feature renderer (`scene-host.ts:353`). The label says "Plate", which is eye makeup's.
- **Normals.** `setNormals` changes the rig, the character and every feature at once (`scene-host.ts:354–358`).
- All three are stored once in `PreviewState` (`workspace-state.ts:30`). A per-view overlay has no home.

### 2.6 Input routing

| Where | Assumption |
|---|---|
| `input-bindings.ts:62` `ViewportScope = "head" \| "uv"`; `:184` `KeyScope` includes `head` and `uv`; `:208–209` `head.front`, `head.menu` | Scopes are fixed viewport kinds, not view instances. |
| `input-bindings.ts:64` `PointerTarget` | Makeup's targets only (point, tangent, warp, shape). A non-makeup view has only `empty`. |
| `authoring-gestures.ts:8` `GestureSource = "uv" \| "surface"` | A gesture's source is a fixed kind, not a view. |
| `viewport-attachment.ts:27` | `ViewportInputSnapshot` has exactly `head` and `uv`. |
| `studio-ui/panels/viewports.ts:88–95` | `attach("head")`, `contextMenuGate("head")` and the `head` key scope. |
| `surface-editor.ts:724–735`, `uv-editor.ts:419–448` | Window-level `pointerdown`, `blur` and `keydown` listeners per editor instance. They are correct per instance, but every instance hears every key. Routing must check the focused view. |
| `browser-viewport-device.ts:61–69` | Window-level modifier tracking. This one is right as global state: modifiers are not per view. |

### 2.7 Preview jobs

- `browser-preview-device.ts:52` has one `viewer`, and `connectScene` (`:131`) binds the raster coordinator's canvases to one scene's makeup stack.
- `compose/renderers.ts:18–19` (`STUDIO_LAYERED_SURFACES`) and `studio-startup.ts:129` (`liveSurface`) connect exactly one layered surface. `browser-head-attachment.ts:110` refuses a second on-head editor.
- Preview quality (`quality.set`) and readiness are the live document's coordinator (`studio-startup.ts:170`, `:209`). The textures they size are shared GPU resources, so quality stays global (not per view) in the model.

### 2.8 Render loop and resize

- The render scheduler (`render-scheduler.ts`) is pure and clock-injected. That is good: one scheduler can drive a draw list.
- `bindRenderTriggers` (`scene-host.ts:223`) ties invalidation to one controls instance and one canvas.
- `ViewportAttachment.resize` (`viewport-attachment.ts:99–105`) and `cancelInput` (`:106–109`) iterate the two fixed kinds. `studio-ui/app.ts:80–81` and `:153` resize "all" viewports after a layout change.

### 2.9 Application, port and actions

- `StudioTarget { kind: "viewport" }` (`studio-application.ts:68`) carries no view, and its actions (`:712`) are Front, Whole body and Rebuild.
- `previewState()` (`studio-application.ts:388–396`) publishes one preview snapshot.
- The port's `viewport` (`studio-presentation.ts:123–126`, `:299–309`) takes `ViewportHostKind`.
- `PreviewConfig` (`preview-actions.ts:11–13`) mixes four concerns:
  - character visibility: brows, lashes, hair, piercings, body, eye shape;
  - display studies: normals, eye roughness;
  - overlays: surface, wire;
  - lighting: preset, studio lights, exposure, key angle, creator calibration.

### 2.10 Persistence and dock

- **Workspace.** `WorkspaceState.preview` (`workspace-state.ts:26–68`, `:90`) holds one camera (`:28`), one lighting setup (`:59–66`) and one set of toggles. `uvView` (`:86`) is one. `WorkspaceComposer` (`workspace-composer.ts:37–51`) captures one preview, and `trusted-preview-services.ts:16–40` restores it into one port.
- **Panels.** The dock builds each panel once, from the static catalogue (`studio-ui/app.ts:51–60`). `DockView` takes its panel list at construction only (`studio-ui/dock/dock-view.ts:45–46`). There is no runtime add or remove, so a second view panel cannot appear.
- **Layout parser.** `parseTree` (`studio-ui/dock/layout.ts:356–421`) drops unknown panel IDs and re-adds every missing *known* panel (`:410`). A module's hidden panels would therefore come straight back, and a view panel with a dynamic ID would be dropped. The parser needs to know "parked" and instance IDs.
- **Default layout.** The factory layouts name one `stage` slot and one `g-head` group (`studio-ui/layout-defaults.ts:29–42`). The shell's view contributes exactly one `head` panel (`studio-ui/views/shell.ts:19`).

### 2.11 Capture tools and verification evidence

- `studio-startup.ts:232` publishes `xfStudioSceneEvidence` for the one scene, and `xfStudioLayeredSamples` beside it.
- `tools/scene-parity.ts:85–115` waits on that evidence, reads `#device-head canvas` and compares its pixels.
- The study tools `tools/depth-study.ts` and `tools/glitter-head-study.ts` construct a scene host directly. So do the look tools (`head-look`, `eye-look`, `body-look`, `clothing-look`, `blink-look`, `plate-light-look`), which reach it through the page.
- `public/index.html:19–20` parks exactly one `device-head` host and one `device-uv` host.
- **Migration rule.** Keep the main view's evidence keys and the `#device-head canvas` selector as aliases for view `main` until the tools read evidence per view.

### 2.12 Guidance anchors

- `studio-ui/guidance/anchors.ts:18–19` names `uv.canvas` and `head.view`, one per panel, and the tours point at them (`tours.ts:20`, `:23`).
- With several views, `head.view` should mean the main view, or the focused one. Anchors of a hidden module's panels already fall back ("a closed panel is offered"). A tour step on a hidden module must first offer to show that module (§4).

### 2.13 Tests that encode the singleton

- `tests/viewport-attachment.test.ts` and `tests/browser-viewport-device.test.ts` drive the two-kind attachment.
- `tests/browser-head-attachment.test.ts` drives the one-head attachment.
- `tests/webgl-scene-host.test.ts` runs on a real GPU against the probe page (`tests/webgl-scene-host-probe-page.ts`). It checks one host: frame on demand, dispose leaks and two feature plates. That is a good base for a two-view probe.
- `tests/input-bindings.test.ts`, `tests/head-camera-input.test.ts` and `tests/input-adapters.test.ts` pin the `head` and `uv` scopes.
- `tests/view-contributions.test.ts` checks the derived layouts, including a shell-only composition, but only for layouts.
- `tests/guidance.test.ts` checks the anchors.

All of these stay valid through P1 and P2 if the `head` and `main` aliases hold. The new ratchet (`tests/view-graph-audit.test.ts`) lists:

- the modules outside `platform/scene/` that import the scene host;
- the modules that spell a fixed viewport-kind union;
- the shell modules that name eye makeup's viewport tools.

Each list may only shrink, and each phase in §6 says which list it empties.

### 2.14 Toolbar buttons

The head panel (`studio-ui/panels/viewports.ts`) and its duplicates:

| Control | Source | What it assumes | Hard-coded? | Verdict |
|---|---|---|---|---|
| Crumb "Preset › Layer" | `viewports.ts:64`, `:157–158` (`frame.layer`) | Eye makeup's selected layer | Yes (UI-75 `Frame` row) | A **view summary** contributed by active modules for the view's scene kind |
| Front view | `viewports.ts:65`, capability `:140`; palette `app.ts:412`; menu `target-menus.ts:164`; key `head.front` (`input-bindings.ts:208`) | An orbit camera on a head | Always present | A **platform camera tool** for orbit cameras. Its label and framing come from the scene kind: "Front view" on a character, "Reset view" on a location. |
| Whole body view | `viewports.ts:66`, capability `:141`; palette `app.ts:413`; menu `target-menus.ts:165` | A character scene with a body | Always present, disabled without a body | A **character-scene tool**, absent from other scene kinds |
| Surface controls | `viewports.ts:67–68`, capability `:142`; palette `app.ts:425`; menu `target-menus.ts:167–169`; Camera & light › Display (`preview.ts:144`, `:152`) | Eye makeup's on-head editor, through a platform action | Always present, even with no layer | **Eye makeup's view tool** (toggle, per view). It disappears when eye makeup is hidden or the scene is not a character. |
| Plate wireframe | `viewports.ts:69–70`, capability `:143`; menu `target-menus.ts:170–172`; palette `app.ts:426` (research only); Display (`preview.ts:145`, research only) | Eye makeup's plate | Always shown in the toolbar and the menu, though the palette and panel keep it behind research tools (an inconsistency) | **Eye makeup's view tool**, research placement: shown only with research tools on, everywhere at once |
| Idle | `viewports.ts:71–76`; hidden when motion is unavailable (`:138`) | The subject's rig motion | The only reactively derived button | A **character-scene tool** (subject motion). The Poses placeholder adds its pose menu beside it (§5). |
| Readiness badge | `viewports.ts:63`, `:132` (`previewReadiness`) | Eye makeup's layer queue | Yes | **Per-scene readiness**, aggregated from the active modules' renderers (the `FeatureRenderer.readiness` the platform §5 already plans) |
| Detail status line | `viewports.ts:79–84`, `:146–156` | The character's resolved details | Platform, character-only | Keep, shown for character scenes |
| Hint strip and tooltip | `viewports.ts:78`, `input-hints.ts` (scope `head`) | Makeup targets | Yes (scope and targets) | **Per view.** Targets come from the module tool that owns pointer editing in that view. |
| Loading card | `viewports.ts:47–62`, `:98–123` | The one head's preparation | Platform | Per character scene node; a location scene has its own loading line |
| Context menu "Head view" section | `target-menus.ts:154–172` | Same four buttons as above | Yes | Derived from the same tool list as the toolbar |
| UV panel toolbar (Both, Single, Other, Fit) | `features/eye-makeup/view/uv.ts:13–16` | Eye makeup's flat editor | Feature-owned (correct) | Stays eye makeup's. The `uv` viewport kind below it moves to a module-registered view kind (P6). |

### 2.15 Already fit for more than one view

- **Feature renderers never see the camera.** The `SceneHostPort` (`platform/api/scene.ts:72–117`) exposes the renderer, anchors, attach, band, supersede, skin, character, frame requests and context restores, and no camera. Renderers already draw view-independent content.
- **The renderer registry (`feature-renderers.ts`) is per host.** It owns what each renderer attached, so creating it once per *scene node* is a small change.
- **The pure pieces are reusable as they are.** The render scheduler, the input binding catalogue, the camera framing and navigation helpers, and `CameraState` all fit a node model.
- **Rehosting keeps the editor.** `ViewportAttachment.rehost` already moves the same host into a new slot without destroying its editor. The view panel will rely on that.
- **The `DetailLoader` cache can be shared.** It is keyed by depot hash and container fingerprint, so one cache can serve every scene in one GL context.

## 3. The view graph

### 3.1 Node types

| Node | Holds | Today's source | Shared by default when a view is added? |
|---|---|---|---|
| `scene` | Its kind (`character`, or a module-registered kind such as `location`); for a character: which V (the character context: default, save or creator choices), the look shown (`selected`), the subject's motion (idle, blink, later a pose) and the material studies (eye roughness, normals). A scene node is the unit of GPU content: one `THREE.Scene`, one head rig, one character renderer and one feature-renderer set per node. | `PreviewState.eyeShape`, `character`, `idle*`, `blink*`, `eyeOwnRoughness`, `normals`; `CharacterContextActions` | Yes |
| `camera` | Kind (`orbit` now; `fly` for locations, `game` fed by the runtime bridge later) and pose `{position, target, fov}` in the scene's neutral subject space. Aspect is **not** stored: it belongs to each view. | `PreviewState.camera`; the scene host's camera and controls | No (forked) |
| `lights` | Rig kind (`studio`, `creator`; module kinds such as `sun` later) and its settings: studio lights, key angle, exposure, creator calibration. A creator rig resolves its spot lights from the scene's body sex at draw time, so one rig node can light a feminine and a masculine V correctly. | `lightingPreset`, `studioLights`, `lightAngle`, `exposure`, `creatorLighting` | Yes |
| `display` | Per-view render settings: the **content filter** (which character slots show: brows, lashes, hair, piercings, body, clothing; and each active module's content), the stage backdrop, and a resolution scale. | `brows`, `lashes`, `hair`, `piercings`, `body` | Yes |
| `tools` | Overlays and editing controls: each view tool's on/off state (`eye-makeup.surface`, `eye-makeup.wire`) and whether pointer editing is allowed in this view | `surface`, `wire` | No (forked) |
| `view` | `{ id, kind: "3d", title?, scene, camera, lights, display, tools }`: one reference per slot. It is shown in a dock panel `view.<id>`, and the main view keeps panel ID `head`. | The `head` panel | — |

**Why two nodes for display and tools.** Both are per view by default, but they share differently:

- *Display* changes what the image contains. Two views comparing hair on and off want it separate, while a user comparing lights wants it shared.
- *Tools* are interaction affordances, almost never wanted in two views at once.

**Visibility as a filter, not a load.** The content filter is applied per draw through Three's `camera.layers` mask (each slot's meshes on their own layer), so hiding hair in one view costs nothing in the other. The scene prepares the union of what its views show. The body preparation that `preview.setBody` gates today (PREV-108) prepares when any view shows the body.

**What stays outside the graph.** Preview texture quality (a shared GPU budget of the live document's raster jobs), the UV view (eye makeup's flat editor, until P6) and the UI preferences.

### 3.2 Edges and the example

A view has exactly one edge to each node type. Its scene constrains the rest: a scene kind registers which camera kinds, rig kinds and tools apply (§3.9), and the graph service refuses a link that breaks that. The requested example is this data:

```json
{ "schema": "xfs/view-graph-1",
  "views":   [ { "id": "main", "kind": "3d", "scene": "s1", "camera": "c1", "lights": "l1", "display": "d1", "tools": "t1" },
               { "id": "v2",   "kind": "3d", "scene": "s1", "camera": "c1", "lights": "l2", "display": "d2", "tools": "t2" } ],
  "scenes":  [ { "id": "s1", "kind": "character", "look": "selected" } ],
  "cameras": [ { "id": "c1", "kind": "orbit", "pose": { "position": [0, 1.67, -0.6], "target": [0, 1.67, 0.005], "fov": 30 } } ],
  "lights":  [ { "id": "l1", "kind": "studio", "setup": "soft" }, { "id": "l2", "kind": "creator" } ],
  "display": [ { "id": "d1" }, { "id": "d2" } ],
  "tools":   [ { "id": "t1", "on": { "eye-makeup.surface": true } }, { "id": "t2", "on": {} } ],
  "focused": "main" }
```

Orbiting in either view writes `c1`, which dirties both views. A light change in `v2` writes `l2`, which dirties only `v2`. This is the finish-calibration case the in-game sessions keep raising (Matte and Satin reading glossy): the Studio stage and the creator rig side by side on one V and one camera. It deserves a one-step command, **Compare lighting**, which creates exactly this graph.

### 3.3 Ownership and lifetime

- **The graph.** A DOM-free application service, `platform/core/view-graph.ts`, owns the graph. It validates every edit, counts references and publishes a detached snapshot. It is the one owner of camera, light, display and tool *state*. `PreviewActions` stops storing them and routes to the graph (P1).
- **Garbage collection.** A node lives while a view references it, or while a parked view of a hidden module does (§4). An edit that leaves a node unreferenced removes it in the same commit. There are no dangling nodes and no manual clean-up.
- **GPU objects.** The platform scene layer (`platform/scene/`) owns the GPU objects, one runtime per node:
  - `SceneRuntime` per scene node;
  - `ViewRuntime` per view: a `PerspectiveCamera` at that view's aspect, controls and camera input on its canvas, its editors, its presentation canvas;
  - `LightRigRuntime` per rig and scene pair, because lights must be objects in that scene's graph;
  - one `GraphRenderer` holding the context and the loop.

  Runtimes are created when a node first becomes referenced and disposed when it is collected, with the same release-everything-on-failure rule as today (PREV-20).
- **The subject outlives the GPU.** The character context, saved V and detail actions leave `attachBrowserHead`. They become services of the character scene node, constructed at startup, so a context loss, a failed head load or closing a view never loses which V is shown (P3).

### 3.4 Sharing, forking and linking

| Command | Effect |
|---|---|
| **New 3D view** (header Views menu, palette, a view's menu) | A view of the focused view's scene: it shares the scene, lights and display, and gets a copied camera and fresh tools |
| **Duplicate view** | Shares every node except tools (a mirror of the view) |
| **Compare lighting** | A new view sharing the scene, camera and display, with the other light preset (Studio or Creator) |
| **Link camera to ▸ \<view\>** / **Link lights to ▸** / **Link display to ▸** | Points this view's slot at the other view's node; the old node is collected if unreferenced |
| **Unlink camera** / **Unlink lights** / **Unlink display** | Copies the shared node and points this view at the copy (a fork: both start identical) |
| **Close view** | Removes the view. Its unshared nodes go with it, and it can be reopened from **Reopen closed view** (the last five, like removed presets). The main view cannot be closed. |

The view header shows a small link badge per shared slot, lettered per node ("Camera A" in both views). Hovering highlights the other views that share it. The Camera & light panel follows the focused view and names what is shared ("Lights: shared with Head"). Its sliders edit the node, so the link is visible where the edit happens.

### 3.5 Persistence

- **Format.** `xfs/workspace-2` gains an optional `views` field holding `xfs/view-graph-1`: nodes and views as above, plus `focused` and the recently closed views. It is written **only when the graph differs from the default one-view graph**, the rule `studioLights` already follows. A workspace that never adds a view keeps its bytes.
- **Downgrade.** The main view's nodes are mirrored into the legacy `preview` fields (camera, lighting, toggles), so a build before P1 reads the main view as it does today and ignores `views`. The P4 gate includes the 0.1.0-alpha.1 reader test with a `views` field present.
- **Dock layout.** View panels use `view.<id>` IDs. The parser's known-panel list becomes the catalogue plus the graph's views; a view panel whose view no longer exists is dropped.
- **Verification scope.** All of this is workspace state: `?verify=1` has its own copy, as it does for layout.

### 3.6 Undo scope

- **Camera, light and display changes** record no Undo. They remain workspace view state, as the Camera & light panel already states (`preview.ts:153`), and they never enter look history, recipes or exports.
- **Graph edits** record no look history either: a view is not part of a look. Close view is recoverable through Reopen closed view. Close view and Unlink offer a toast **Undo**, backed by a session-only graph step list (20 steps) that is never persisted.
- **Tool toggles** are view state, not Undo.
- **Gestures** stay exactly as today: one application-wide open gesture, from whichever view started it, recorded in the look history.

### 3.7 Rendering and performance

**One context.** `GraphRenderer` owns one WebGL2 context, so every scene's geometry, textures, bakes, the makeup canvases' textures and the `DetailLoader` cache are shared.

- **One visible view.** The drawing canvas sits in that view's slot and draws directly, exactly as today. This path must stay byte-identical to the current output (the scene-parity gate).
- **Several visible views.** The drawing canvas is offscreen. Each view draws at its own size into the shared scene-linear target (sized to the largest visible view; the renderer's viewport and scissor select the region). It is then output-encoded and copied with `drawImage` into that view's own 2D canvas.

A single full-window overlay canvas with scissored regions (three.js's multiple-elements pattern) is rejected: floating panels, tab groups and composites put other DOM above and between views. The copy costs one GPU blit per drawn view, which is to be measured in P4.

**Per-view draw.** The frame advances every animating scene's rig once. It runs each scene's `beforeDraw` once (eye makeup's composite, only after a change). Then, for each dirty visible view in priority order, it:

1. applies the view's rig: this scene's `LightRigRuntime` for that rig becomes visible and the scene's other rigs hide; it sets `environment`, `background` and `environmentIntensity`;
2. applies the display: the `camera.layers` content mask, the stage, and tone mapping and exposure from the rig;
3. applies tool states through the feature renderers' per-view hook (§3.9);
4. sets its camera's aspect and clip planes;
5. draws.

Rigs differ in light count (the studio rig has three directional lights and a probe; the creator rig has N spot lights). Three compiles one program per light configuration and keeps several per material, so alternating views switches cached programs without recompiling after the first draw of each. The P3/P4 GPU probe must confirm that the program count is stable after warm-up.

**Dirty propagation.**

- A node change dirties the views that reference it.
- A scene change, such as a layer update or a V switch, dirties the views of that scene.
- A layout change dirties only the resized views.
- The idle and Play blink dirty the views of an animating scene every frame.

**Budget.**

| Policy | Default |
|---|---|
| Visible 3D views | At most 4. A fifth opens as a tab in the focused view's group. |
| Frame order | The focused view first, then the others round-robin |
| CPU budget per frame | 12 ms. Dirty non-focused views that don't fit wait for the next frame; the focused view is never deferred. |
| Animating non-focused views | Half rate. A preference allows full rate. |
| Hidden views (background tab, zero size, parked, minimised floating window) | Not drawn. Marked dirty and drawn once when revealed (`visibleViewportSize` already detects zero size). |
| Memory per extra view | Its presentation canvas (w × h × 4 bytes) and its editors. The multisampled half-float target is shared at the largest visible size. |

`frameTiming()` becomes per view (frames, requests, median and p95 per view) so the budget is measured, not guessed.

### 3.8 Input routing and focus

- **Focus.** The focused view is the last view that received a pointer press or keyboard focus. The graph publishes it and stores it (restored on reload). View-scoped keys (today `head.front`, `head.menu`) resolve against it, the Camera & light panel follows it, and palette commands such as Front view act on it.
- **Cameras.** Each view has its own controls and camera input on its own canvas. The controls that start a gesture write the camera node, damping included. Views linked to that camera follow the node each frame, and their controls are updated from it without echoing back.
- **Editors.** A view gets an on-head editor when its tools enable a module's editing tool and its scene shows the live look. The editor picks with that view's camera and canvas. The application still allows one open gesture at all, so two views can never edit at once. `GestureSource` becomes `{ view: ViewId }` (a flat editor is a view too, P6).
- **Global listeners.** The editors' window-level `keydown`, `blur` and `pointerdown` listeners act only while their own gesture is open (they already check `drag`/`wheel`). The rule to keep: no window listener acts without an open gesture of its own instance.
- **Hints and menus.** `ViewportInputSnapshot` becomes `{ modifiers, views: Record<ViewId, EditorInputState> }` (modifiers stay global). Each view panel has its own hint strip. `viewportMenu(view)` builds the hit section, then the view's tools, then the link menu.
- **Bindings.** `KEY_BINDINGS` scope `head` becomes a `view3d` scope that applies to any 3D view. The catalogue stays one table, and tests check every scope a view kind registers.

### 3.9 How modules contribute to each view

A **Studio module** is the unit a person shows or hides. It has a manifest, and every contribution carries its module ID. A feature module (§1 of the platform) is presented by the Studio module of the same ID; a module need not have a document part (Poses and World have none).

```ts
// platform/api/module.ts (sketch)
export type ModuleId = string & { readonly __module: unique symbol };
export interface StudioModule {
  readonly id: ModuleId;                       // "eye-makeup", "poses", "world"
  readonly label: string; readonly icon: IconName;
  readonly group: "character" | "world" | "assets" | "tools";   // the Modules menu's sections
  readonly stage: "stable" | "preview" | "dev";
  readonly feature?: FeatureId;                // the feature module it presents, if any
  readonly shownByDefault: boolean;
}

// platform/api/view-graph.ts (sketch)
export type SceneKind = "character" | (string & {});
export interface SceneKindContribution {       // a module's own kind of content (World: "location")
  readonly kind: SceneKind; readonly module: ModuleId;
  readonly cameras: readonly CameraKind[]; readonly rigs: readonly RigKind[];
  create(port: SceneContentPort): SceneContent; // Three allowed: the module's render/ folder
}
export interface ViewToolContribution {
  readonly id: string;                         // "eye-makeup.surface"
  readonly module: ModuleId | "platform";
  readonly label: string; readonly icon: IconName; readonly order: number;
  readonly scenes: readonly SceneKind[];       // where it applies
  readonly placement: "toolbar" | "menu" | "research";
  readonly kind: "toggle" | "action" | "menu";
  readonly state: "tools" | "camera" | "scene"; // which node holds its state
}
export interface ViewSummaryContribution {     // the crumb: "Preset › Layer"
  readonly module: ModuleId; readonly scenes: readonly SceneKind[];
}
```

What each contribution does:

- **Scene content.** `FeatureRendererFactory` gains `scenes: SceneKind[]` (eye makeup: `["character"]`). The platform creates one renderer set per scene node of a matching kind, not per view. A module's own scene kind registers a `SceneKindContribution`, whose content receives a `SceneContentPort`: the scene port without the head anchors, plus the shared detail and texture caches.
- **Per-view differences** reach a renderer only through one optional hook, `FeatureRenderer.viewTools?(on: Readonly<Record<string, boolean>>)`. It is called before each view's draw with that view's states for the feature's own tools; eye makeup's wireframe is a per-draw material flag. A renderer never sees a camera, rig or view ID (rule 4, §6.3).
- **Tools, the toolbar and menus** are derived, not written. Derivation lives in the application, so a future UI or an MCP client gets the same list. `port.views.tools(view)` returns the platform's tools and the tools of **shown** modules whose `scenes` include the view's scene kind, filtered by placement and the research preference and sorted by `order`. Each entry carries its current state and capability. `port.views.setTool(view, id, value)` dispatches through the registry. The toolbar, the view's context-menu section, the palette's View group and the Camera & light panel's Display section all render this one list. They re-derive on module visibility, the view's scene kind, the research preference and capability changes (at paint time, like every capability today).
- **Summaries and readiness.** The crumb is the shown modules' summaries for the scene. Readiness is aggregated from the scene's renderers.
- **Bindings.** A module's pointer targets and keys are its `InputBindingContribution` (platform §1). The hint strip in a view lists only the targets of tools active there.

Platform tools, by scene kind:

| Tool | Scenes | State |
|---|---|---|
| Front view (orbit framing; "Reset view" off a character) | all with an orbit camera | camera |
| Whole body view | `character` | camera |
| Idle (play, pause) | `character` | scene |

Eye makeup contributes Surface controls (`toolbar`, `tools` state), Plate wireframe (`research`, `tools` state), its summary and its readiness.

### 3.10 Modules that are not about V

The graph has no V-specific slot. A non-V module:

1. **Registers a scene kind.** World registers `location`, whose content is streamed sectors (§3.1 of [world and streaming](../../knowledge/world-and-streaming.md)). An assets module registers `asset`: one mesh or appearance resolved by the generic resolver.
2. **Reuses camera and rig kinds.** It reuses `orbit` and `studio`, or registers its own (`fly`; `sun` for time of day).
3. **Contributes tools for its kind.** For example, World's streaming radius.
4. **Gets the rest from the platform.** Its views get dock panels, linking, focus, hints, budget, persistence and parking the same way.

A 2D **map** is a different view kind (`map2d`), registered with its own view runtime. It shares everything above except the 3D draw path. Character tools never appear on these views, because their `scenes` list names only `character`.

Placing a V into a location later is a `location` scene that references a character node. The graph allows it; nothing in P1–P5 builds it.

## 4. Module activation

### 4.1 Options

| Option | How it works | For | Against |
|---|---|---|---|
| **A. Exclusive modes** | One module at a time; switching swaps panels, views and tools | Uncluttered, simple to explain | One look spans several features with one history. Eye makeup is judged on the V, with Character and Poses beside it. Switching back and forth would be constant. |
| **B. Combinable modules** (proposed default) | Each module shown or hidden independently, from a **Modules** menu | Matches "one look, many features"; panels simply appear and disappear | More panels as modules grow |
| **C. Named workspaces** (later, on top of B) | A workspace is a set of shown modules, a dock layout and a view graph, switched from tabs in the header (Blender-like) | Cures B's clutter once there are many modules; a "World" workspace can hide every V module | Heavier; premature with three modules |

**Default: B now, C once there are about four shown-able modules.** C is additive: a workspace is a saved B state.

### 4.2 The Modules menu

It replaces the header's authoring-category label (`studio-ui/app.ts:251`), which today reads "Eye makeup" because only one feature is registered.

- **Layout.** One checkbox row per module, grouped (Character: Eye makeup, Poses; World: World), with a stage badge ("Preview") and one plain line of what it adds ("Adds 6 panels and 2 view tools").
- **Palette.** "Show Eye makeup" and "Hide Eye makeup" appear as palette commands.
- **Storage.** The state is `UIPreferences.modules` (workspace and verification-scoped, like the layout), with defaults from each manifest.
- **Boundary.** It is a presentation preference only. The application never reads it, and actions stay dispatchable (a future MCP client can still drive a hidden module).

### 4.3 Hiding a module

- **Panels** leave the dock. Their places are **parked** per size class in the dock state: each panel's group sibling and index, or its floating window rectangle. Showing the module again puts each panel back where it was (`openPanel` with the remembered siblings). A group emptied by hiding collapses and is recreated beside its remembered sibling. The parser treats a hidden module's panels as known but parked, so it does not re-add them (fixing the `layout.ts:410` behaviour for this case).
- **View tools, summaries, bindings and hint targets** vanish from every view at once, because they are derived (§3.9).
- **Views of the module's own scene kind** (a World location view) are parked with its panels. Their graph nodes stay.
- **Content** keeps drawing: the look is unchanged, and hiding the editor is not hiding the makeup. Each view's display node has **Show in this view** per module for anyone who wants the V without it (question Q2).
- **Data and exports** are untouched. Parts, history and the package plan are the same whether the module is shown or not.
- **An open gesture or form edit** of the module is committed or cancelled (Escape rules) before its panels go.
- **A guidance tour** that reaches a hidden module's anchor offers "Show Eye makeup" as that step's action, instead of skipping.
- **The shell** always stays: Presets, Library, Mod package, History, the main view, Character, Camera & light, Motion, Quality, Activity and Help. With every module hidden, the Studio is still usable (the UI-75 end state: "the shell mounts with no features").

## 5. Placeholder modules

Both placeholders are listed under Modules as **Preview** and hidden by default (question Q6). Neither pretends to a capability it lacks. Every line they show is true and actionable, and nothing claims poses or locations load.

### 5.1 Poses (V-centric, no document part)

It follows the [pose library design](../animation/pose-library-design.md) §6–7, which already says the library is not a feature module. That is exactly a Studio module without a part.

| Piece | Placeholder |
|---|---|
| Manifest | `poses`, group `character`, stage `preview`, no feature |
| Panel `poses.library` | Beside Character (slot `inspect`). The design's two fixed entries, both real: **Creator idle** (`motion.setIdle` on; the existing clip decoded from the game) and **Stand still** (idle off). Below them one line: "Poses from your game and mods will be listed here." A disabled search field shows where search goes. |
| View tool `poses.menu` | A `menu` tool on character scenes: the same two entries. It appears in the toolbar only while Poses is shown, which demonstrates derivation. |
| Second view | **Open a whole-body view** in the panel creates view `v2`, sharing the scene and lights, with its own camera framed by `camera.body`. It demonstrates two views of one V: a head close-up and the whole body. |
| Later | P0–P3 of the pose library replace the placeholder list; `BodyPosePort` becomes the character scene's, so both views pose together. |

### 5.2 World (non-V)

| Piece | Placeholder |
|---|---|
| Manifest | `world`, group `world`, stage `preview`, no feature |
| Scene kind `location` | Placeholder content in its `render/`: a ground grid, axes and a horizon, lit by a `studio` rig, with the one line "Night City locations will appear here in a later version." No streaming, no resolver work and no game data. |
| Panel `world.locations` | An empty list with **Open a location view**, which creates a view with a new `location` scene, a new `orbit` camera and new lights |
| Toolbar on that view | Only **Reset view**, the orbit camera's platform tool. No Front, Whole body, Idle, Surface controls or Plate wireframe: their `scenes` lists name only `character`. This is the demonstration that buttons follow content. |
| Later | [World and streaming](../../knowledge/world-and-streaming.md) §3.1: sector selection, the native sector reader and instanced drawing replace the grid. |

### 5.3 Minimal wiring

Beyond the platform work of P1–P4:

- `compose/modules.ts` lists `EYE_MAKEUP_MODULE`, `POSES_MODULE` and `WORLD_MODULE`;
- `compose/views.ts` adds the two contributions (panels and tools);
- `compose/scene-kinds.ts` lists World's `location` kind;
- `features/poses/view/` and `features/world/{view,render}/` hold the code.

**Acceptance test (as platform §9):** adding either module touches no file outside its own folder except the `compose/` lists.

## 6. Migration plan

Each phase leaves `main` green: suite, typecheck, bundle build and its gates. Effort is in agent-days.

### 6.1 Phases

| # | Phase | Scope | Gates | Effort |
|---|---|---|---|---|
| P0 | Audit and ratchets | This page; `tests/view-graph-audit.test.ts` | The ratchets pass on `main` | 0.5 (done) |
| P1 | View identity and the graph service, one view | `platform/api/view-graph.ts` types. `platform/core/view-graph.ts` (DOM-free): nodes, reference counts, link and fork, validation, the default graph derived from `preview`, `xfs/view-graph-1` read and write. `PreviewActions` split behind the same action kinds into camera, lights, display, scene and tool handlers that edit graph nodes; camera, preview and motion actions gain an optional `view` (default: the focused view). `StudioTarget {kind: "viewport", view}`. `GestureSource = {view}`. `ViewportAttachment` keyed by view ID, with `head` kept as the port's alias for `main`. `SceneHostPort.lighting()` and `subscribeLighting` removed (unused). | The registry golden changes only by the optional `view` payload fields. Workspace fixtures round-trip byte-identical. Existing tests unchanged. The ratchet's fixed viewport-kind list loses `authoring-gestures`, `viewport-adapter` and `viewport-attachment`. | 3 |
| P2 | Modules and derived tools | `platform/api/module.ts`, `compose/modules.ts`, `UIPreferences.modules`, the Modules menu. Parked layouts in the dock state; `parseTree` takes shown and parked panels; `DockView` adds and removes panels at run time. `ViewToolContribution`, platform tools and `port.views.tools/setTool`. The head toolbar, its context-menu section, the palette's View entries and Camera & light › Display derived from one list. Eye makeup contributes Surface controls, Plate wireframe (research placement everywhere), its summary and its readiness. | Pure derivation tests (eye makeup shown or hidden, research on or off, each scene kind). A parked-layout round trip per size class. A shell-only composition mounts (the UI-75 runtime row). The ratchet's shell-tool list is emptied. `?verify=1`: hide eye makeup, then show it, and the layout returns exactly. | 3 |
| P3 | Scene host split, still one view | `SceneRuntime`, `ViewRuntime`, `LightRigRuntime` and `GraphRenderer` in `platform/scene/` (one context, one scheduler, dirty propagation and a draw list; the direct-draw path for one visible view). The character context, saved V and detail actions leave the head attachment and become the character scene's services. The flat host API is replaced by per-node ports. `setWire`/`setNormals` become the per-view tool hook and a scene study. | Scene parity **byte-identical** (`tools/scene-parity.ts`: 20 frames, both presets, 1K and 2K). Ready at 1K and 2K within noise. Frame-on-demand and dispose-leak GPU tests. Context loss and restore. The ratchet's scene-host list shrinks to the viewport device. | 6 |
| P4 | Multiple views | New, Duplicate and Close view, Compare lighting, Link and Unlink per slot, Reopen closed view. Dynamic `view.<id>` panels. Focus routing, per-view editors, hints and menus. Camera & light follows focus with link badges. Graph persistence and legacy mirroring. The blit path, the frame budget and hidden-view pause. | A two-view GPU probe: orbiting the shared camera moves both views; a light change in one leaves the other's pixels byte-identical; a hidden view draws no frames; the program count is stable after warm-up; 1–4 views timed per view. `?verify=1` session. The 0.1.0-alpha.1 reader opens a workspace with `views`. | 4 |
| P5 | Placeholder modules | Poses (panel and tool after P2; the whole-body view after P4) and World (after P4), as in §5 | The acceptance test (only `compose/` lists touched). Derivation shows no character tools on a location view. `?verify=1`: show and hide both, open both views, reload. | 2 |
| P6 | Later, not scheduled | The UV map as a module-registered flat view kind (closes the UI-75 `uv` row); a scene pinned to another look (compare two presets; needs raster jobs for a non-live look); two character nodes (compare two Vs); named workspaces; per-view material studies | — | — |

P1 and P2 can run in parallel: P1 is the core and port, P2 the shell and dock. Only the tool dispatch joins them, through `port.views`. P3 needs P1. P4 needs P2 and P3. Total P1–P5: about 18 days, with 17–19 as the range.

### 6.2 Tests to add

- **Graph service** (pure): link, fork and collect; validation against scene kinds; the default graph from each workspace fixture; round trip; a byte-identical workspace when the graph is the default.
- **Derivation** (pure): tools, summaries and readiness per view, across module visibility, scene kind and research preference.
- **Dock**: parked panels per size class, dynamic view panels, and the parser not re-adding parked panels.
- **GPU probe** (extends `tests/webgl-scene-host.test.ts`): two views over one scene, as in the P4 gate.
- **Boundary**: the rules below, each shown to fail on an injected violation as the existing boundary tests do.

### 6.3 Boundary rules to add

1. Nothing outside `platform/scene/` and the browser viewport device imports the scene host. This is today's ratchet, turned into a rule after P3.
2. No module spells a fixed viewport-kind union: views are `ViewId`s and view kinds are registered (ratchet, then a rule after P1 and P6).
3. studio-ui names no module's view tool, summary or readiness. The toolbar, menus, palette and Display section render `port.views` (ratchet, then a rule after P2).
4. Feature renderers are view-independent. `platform/api/scene.ts` names no camera, light rig or view type, and a renderer's only per-view input is `viewTools`.
5. Camera, light, display and tool state has one owner, the view graph service. No other service stores it (`PreviewActions` included), and no device writes it except through the graph's port.
6. Module visibility is presentation state. No application, platform or feature module reads `UIPreferences.modules`.
7. Registry completeness: every tool, summary, scene kind and renderer names a registered module. Every scene kind lists at least one camera kind, and every tool's `scenes` are registered kinds. A golden snapshot of the module registry guards against ID churn.

### 6.4 Risks

| Risk | Mitigation |
|---|---|
| GPU cost doubles with two animating views | Focused view first, half rate for the others, the 12 ms budget and hidden-view pause, measured per view in P4 |
| Light-rig swaps recompile shaders every frame | Cached program variants per material; the P4 probe asserts a stable program count |
| The blit changes colours or bytes | The one-view path draws directly (parity gate). The multi-view path is compared with a direct draw of the same view in the probe. |
| Linked controls fight (damping and echo) | Only the controls that started a gesture write the node; the others follow without emitting changes |
| Tools and capture scripts break on the new structure | The `head`/`main` aliases, `#device-head canvas` for view `main` and the evidence keys stay until the tools read evidence per view |
| Workspace downgrade | The `views` field is written only when needed, and the main view is mirrored into the legacy fields. The reader test is part of the P4 gate. |
| Subject services moved out of the head attachment change restore order | P3 keeps the existing restore order (saved V, then optics, eye shape and details, then motion, then camera) and its tests |
| Placeholders read as promises | Stage "Preview", hidden by default, one true line each, nothing faked |
| Scope creep into world rendering | World's placeholder draws a grid only; streaming stays behind the native mesh phase |

## 7. Open questions, with proposed defaults

| # | Question | Proposed default |
|---|---|---|
| Q1 | Are modules exclusive or combinable? | Combinable, from a Modules menu; named workspaces later, as saved sets |
| Q2 | Does a hidden module's content still draw on V? | Yes, the look is unchanged; each view can hide a module's content |
| Q3 | What does a new view share? | Scene, lights and display; camera copied; tools fresh. Compare lighting as its own command. |
| Q4 | Do camera, light or graph edits enter Undo? | No; they are workspace view state. Close view is reopenable, and Close and Unlink offer a toast Undo. |
| Q5 | How many views may show at once, and at what cost? | 4 visible; focused view at full rate, others at half while animating; hidden views paused |
| Q6 | Are the placeholders shown by default? | Listed under Modules as Preview and hidden until switched on; the `?verify=1` tests switch them on |
| Q7 | Should a view be able to show a look other than the selected one (compare presets A and B)? | Later (P6): it needs raster jobs for a non-live look |
| Q8 | Two different Vs side by side? | Later (P6): the graph allows two character nodes, but the character context is single today |
| Q9 | Should the UV map become a view in the graph? | Yes, in P6, as eye makeup's flat view kind; it stays a panel until then |
| Q10 | Does the Camera & light panel follow the focused view, or live in each view? | It follows the focused view and names what is shared; each view's header has a small link menu |
| Q11 | Is Poses its own module or part of Character? | Its own module (the pose library design already keeps it out of the feature-module registry) |
| Q12 | Should a camera be able to follow the game's camera through the runtime bridge? | Yes, later: a `game` camera kind fed by the bridge would give the parity measurement's matched framing for free ([game parity measurement](game-parity-measurement.md)) |

## Related pages

- [Feature-module platform](feature-module-platform.md): §1 registration, §4 routing, §5 rendering; this page extends them
- [Presentation boundary](ui-architecture-boundary.md): the UI-75 couplings, the `uv` viewport-kind row and the scene-host exception
- [Input bindings](input-bindings.md): scopes, targets and the head camera
- [Capability inventory](ui-capability-inventory.md): "comparison views" in the expansion map
- [Pose library design](../animation/pose-library-design.md) and [world and streaming](../../knowledge/world-and-streaming.md): the two placeholder modules' later substance
