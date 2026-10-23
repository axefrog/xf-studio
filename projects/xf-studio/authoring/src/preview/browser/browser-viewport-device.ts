import type * as THREE from "three";
import { createSceneRuntime, type SceneDevice, type SceneRuntime } from "../../platform/scene/scene-host";
import { createRendererDevice, type RendererDevice, type RendererDeviceOptions } from "../../platform/scene/renderer-device";
import type { FeatureRendererFactory } from "../../platform/api/scene";
import type { CoreBody } from "../../character/render-detail";
import type { LayeredMakeupRegion } from "../../engines/layered-makeup/region";
import { createSurfaceEditor, surfaceEditorParts, surfaceGuideStandIns, type SurfaceEditorParts } from "../../legacy/eye-makeup/browser/surface-editor";
import { createUVEditor } from "../../legacy/eye-makeup/browser/uv-editor";
import { modifiersOf, NO_MODIFIERS } from "../../app/input-bindings";
import { ViewportAdapter } from "../../app/viewport-adapter";
import { ViewportAttachment, type ViewportAttachmentPort, type ViewportHostKind } from "../../app/viewport-attachment";

type Scene = SceneRuntime;
type UVEditor = ReturnType<typeof createUVEditor>;
type SurfaceEditor = ReturnType<typeof createSurfaceEditor>;

/** Browser resource owner. The presentation receives only `attachment`, never these handles. */
export function createBrowserViewportDevice(options: {
  /** The live feature's region: the layer models its editors' shape edits validate with and the mirror their hit tests reflect across. */
  region: Pick<LayeredMakeupRegion, "models" | "mirror">;
  headHost: HTMLElement;
  uvHost: HTMLElement;
  queryContext: ViewportAttachmentPort<HTMLElement>["queryContext"];
  /** The feature renderers each loaded head creates (the composition's list, handed down by the composition root). */
  renderers?: readonly FeatureRendererFactory[];
  optionalRenderers?: import("../../platform/api/experiments").ExperimentPort;
  referenceTextures?: import("../../platform/api/scene").SceneHostPort["referenceTextures"];
  sceneFactory?: typeof createSceneRuntime;
  /** The head pane's renderer device (default: the browser's; tests pass a stand-in). Made when the first head is built. */
  deviceFactory?: (host: HTMLElement, options: RendererDeviceOptions) => SceneDevice & Pick<RendererDevice, "show">;
  /** The head's WebGL context was lost or came back (the renderer device reports it; the composition root logs it). */
  onContext?: (event: "lost" | "restored") => void;
  uvFactory?: typeof createUVEditor;
  surfaceFactory?: typeof createSurfaceEditor;
  /** Source of key, pointer, focus and visibility events for modifier tracking. */
  window?: Pick<Window, "addEventListener"> & { document?: Pick<Document, "addEventListener" | "visibilityState"> };
}) {
  const editors = new ViewportAdapter();
  /** The head pane's one renderer device (profiles phase 4a-ii): made with the first head, kept for the window. */
  let device: SceneDevice & Pick<RendererDevice, "show"> | undefined;
  /** The head shown on the device (several may be resident; the scene runtime owner decides which: preview/scene-residency.ts). */
  let viewer: Scene | undefined;
  /** Who else hears the context's loss and restore (the runtime owner drops warm runtimes on a loss). */
  const contextListeners = new Set<(event: "lost" | "restored") => void>();
  let uvEditor: UVEditor | undefined;
  let surfaceEditor: SurfaceEditor | undefined;
  /** Each head's stand-ins for the on-head editor's guides, compiled with it before it is shown (`surfaceGuides`); they go with the head. */
  const guides = new Map<Scene, ReturnType<typeof surfaceGuideStandIns>>();
  /** Each head's on-head editor parts (its surface map and occlusion trees), made before it is shown (`surfaceSteps`); they go with the head. */
  const editorParts = new Map<Scene, { surface: THREE.SkinnedMesh; parts: SurfaceEditorParts }>();
  const partsFor = (scene: Scene, surface: THREE.SkinnedMesh) => {
    let made = editorParts.get(scene);
    if (!made || made.surface !== surface) editorParts.set(scene, made = { surface, parts: surfaceEditorParts(scene.head, scene.eyes, surface) });
    return made.parts;
  };
  // Each registered viewport host's element and the editor slot its input and capture belong to.
  const hosts: Record<ViewportHostKind, { element: HTMLElement; editor: string }> = {
    head: { element: options.headHost, editor: "surface" }, uv: { element: options.uvHost, editor: "uv" } };
  const host = (kind: ViewportHostKind) => hosts[kind].element;
  const attachment = new ViewportAttachment<HTMLElement>({
    moveHost: (kind, slot) => {
      const node = host(kind);
      if (slot === node || node.contains(slot)) throw Error("A viewport cannot be hosted inside itself.");
      slot.append(node);
    },
    measure: kind => ({ width: host(kind).clientWidth, height: host(kind).clientHeight }),
    resize: kind => {
      if (kind === "head") viewer?.resize();
      editors.resize(hosts[kind].editor);
    },
    cancelInput: kind => editors.cancelInput(hosts[kind].editor),
    inputCapture: kind => editors.capture()[hosts[kind].editor] ?? false,
    headView: () => viewer?.cameraState(),
    uvView: () => uvEditor?.snapshot(),
    uvSelection: () => uvEditor?.selection?.(),
    uvCommand: command => uvEditor?.viewCommand(command) ?? false,
    uvNavigate: command => uvEditor?.navigate?.(command) ?? false,
    hitAt: (kind, x, y) => kind === "uv" ? uvEditor?.hitAt(x, y) : surfaceEditor?.hitAt(x, y),
    queryContext: options.queryContext,
  });
  // Held modifiers for hints and cursors. Key and pointer events both carry the live state (a
  // pointer event also resyncs after a key was released elsewhere); blur or a hidden page
  // clears them, so no modifier can stay stuck after the window loses focus.
  const events = options.window ?? (typeof window === "undefined" ? undefined : window);
  if (events) {
    const track = (event: Event) => attachment.reportModifiers(modifiersOf(event as KeyboardEvent));
    for (const type of ["keydown", "keyup", "pointermove", "pointerdown"]) events.addEventListener(type, track, { capture: true, passive: true });
    events.addEventListener("blur", () => attachment.reportModifiers(NO_MODIFIERS));
    events.document?.addEventListener("visibilitychange", () => {
      if (events.document?.visibilityState === "hidden") attachment.reportModifiers(NO_MODIFIERS);
    });
  }
  /** The on-head editor goes with the head it edits: an open gesture is settled (cancelled), and its listeners leave the canvas. */
  function releaseEditor() {
    editors.detach("surface");
    surfaceEditor = undefined;
  }
  return {
    attachment,
    mountUV(canvas: HTMLCanvasElement, controls: Parameters<typeof createUVEditor>[1],
      hooks: Omit<Parameters<typeof createUVEditor>[2], "region">, initial: Parameters<typeof createUVEditor>[3]) {
      uvEditor = (options.uvFactory ?? createUVEditor)(canvas, controls,
        { ...hooks, region: options.region, input: state => attachment.reportInput("uv", state) }, initial);
      editors.attach("uv", uvEditor);
      attachment.setReady("uv");
      return uvEditor;
    },
    /**
     * Build a head with a body's core (the feminine V's by default), hidden on the pane's renderer device, whatever is shown meanwhile.
     * It rejects with `signal.reason` once the signal aborts (a newer subject or body change superseded it), having released what it made.
     */
    buildHead(body: CoreBody = "female", signal?: AbortSignal) {
      device ??= (options.deviceFactory ?? createRendererDevice)(options.headHost, { onContext: event => {
        options.onContext?.(event);
        for (const listener of [...contextListeners]) listener(event);
      } });
      return (options.sceneFactory ?? createSceneRuntime)(device, { body, renderers: options.renderers, optionalRenderers: options.optionalRenderers,
        referenceTextures: options.referenceTextures, signal });
    },
    /** Draw `scene` (built by `buildHead`): the head shown before stops being drawn, and its on-head editor goes (a gesture is settled). */
    showHead(scene: Scene) {
      if (viewer === scene) return;
      releaseEditor();
      viewer = scene;
      device!.show(scene.slot);
    },
    /** `scene` stops being the shown head (another is about to be shown, or it goes): its on-head editor goes, a gesture settled. */
    hideHead(scene: Scene) {
      if (viewer !== scene) return;
      releaseEditor();
      viewer = undefined;
    },
    /** Dispose a head (shown or not); the renderer device stays. A head shown now is hidden first. */
    disposeHead(scene: Scene) {
      if (viewer === scene) { releaseEditor(); viewer = undefined; }
      guides.get(scene)?.dispose(); guides.delete(scene); editorParts.delete(scene);
      scene.dispose();
    },
    /**
     * What the on-head editor will add to `scene` once mounted on it (its guides), as stand-ins to compile with the head before it is shown,
     * so its first shown frame links nothing of theirs (profiles phase 4a-v-b). They live as long as the head, keeping those programs.
     */
    surfaceGuides(scene: Scene): readonly THREE.Object3D[] {
      let made = guides.get(scene);
      if (!made) guides.set(scene, made = surfaceGuideStandIns());
      return made.objects;
    },
    /**
     * The steps that make the on-head editor's parts for `surface` on `scene` ahead (its surface map and occlusion trees, tens of milliseconds
     * each), for a head prepared before it is shown: the editor mounted at show takes them made (profiles phase 4a-v-b).
     */
    surfaceSteps(scene: Scene, surface: THREE.SkinnedMesh): readonly (() => void)[] { return partsFor(scene, surface).steps; },
    /** Hear the head pane's context being lost and coming back. Returns the unsubscribe. */
    onContext(listener: (event: "lost" | "restored") => void) { contextListeners.add(listener); return () => { contextListeners.delete(listener); }; },
    /** Mount the on-head editor over `surface` (the layered-makeup surface a feature renderer draws: eye makeup's plate), on the shown head. */
    mountSurface(surface: THREE.SkinnedMesh, hooks: Omit<Parameters<typeof createSurfaceEditor>[1], "region">) {
      if (!viewer) throw Error("The head scene must be shown before mounting surface controls.");
      const { renderer, scene, camera, head, eyes, controls, cameraInput, onFrame, requestRender } = viewer;
      surfaceEditor = (options.surfaceFactory ?? createSurfaceEditor)({ renderer, scene, camera, head, eyes, controls, cameraInput, onFrame,
        requestRender, plate: surface }, { ...hooks, region: options.region, input: state => attachment.reportInput("head", state) }, partsFor(viewer, surface));
      editors.attach("surface", surfaceEditor);
      return surfaceEditor;
    },
    headReady() { attachment.setReady("head"); },
    failHead(error: string) { attachment.setError("head", error); },
    headPending(phase: "loading" | "preparing" | "unavailable", message: string, progress: number | null = null) {
      attachment.setPending("head", phase, message, progress);
    },
    /** How far the head the drawn view wants is being built and prepared (null: none is); the pane shows it (phase 4a-v). */
    headPreparation(state: Parameters<ViewportAttachment<HTMLElement>["setPreparation"]>[1]) { attachment.setPreparation("head", state); },
    /** The recipe or selection changed: redraw the UV pane, and the head's next frame (its handles follow them). */
    drawUV() { uvEditor?.draw(); viewer?.requestRender(); },
    capture() { return editors.capture(); },
    uvEditor() { return uvEditor; },
    surfaceEditor() { return surfaceEditor; },
    scene() { return viewer; },
  };
}
