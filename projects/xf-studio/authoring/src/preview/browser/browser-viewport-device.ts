import type * as THREE from "three";
import { createSceneRuntime, type SceneDevice, type SceneRuntime } from "../../platform/scene/scene-host";
import { createRendererDevice, type RendererDevice, type RendererDeviceOptions } from "../../platform/scene/renderer-device";
import type { FeatureRendererFactory } from "../../platform/api/scene";
import type { CoreBody } from "../../character/render-detail";
import { modifiersOf, NO_MODIFIERS } from "../../app/input-bindings";
import { ViewportAdapter } from "../../app/viewport-adapter";
import { ViewportAttachment, type ViewportAttachmentPort, type ViewportHostKind } from "../../app/viewport-attachment";

import type { BrowserEditorAdapters, EditorBinding, SurfaceEditor } from "./editor-adapters";

type Scene = SceneRuntime;
/** The device's scene view handed to registered editors; they do not depend on the full scene-host API. */
export type EditorScene = Pick<SceneRuntime, "renderer" | "scene" | "camera" | "head" | "eyes" | "controls" | "cameraInput" | "onFrame" | "requestRender">;

/** Browser resource owner. The presentation receives only `attachment`, never these handles. */
export function createBrowserViewportDevice(options: {
  headHost: HTMLElement;
  /** Supplied by the edited feature; absent means camera-only input and no editor resources. */
  surface?: BrowserEditorAdapters["surface"];
  signal?: AbortSignal;
  queryContext: ViewportAttachmentPort<HTMLElement>["queryContext"];
  /** The feature renderers each loaded head creates (the composition's list, handed down by the composition root). */
  renderers?: readonly FeatureRendererFactory[];
  optionalRenderers?: import("../../platform/api/experiments").ExperimentPort;
  referenceTextures?: import("../../platform/api/scene").SceneHostPort["referenceTextures"];
  sceneFactory?: typeof createSceneRuntime;
  /** The head pane's renderer device (default: the browser's; tests pass a stand-in). Made when the first head is built. */
  deviceFactory?: (host: HTMLElement, options: RendererDeviceOptions) => SceneDevice & Pick<RendererDevice, "show" | "dispose">;
  /** The head's WebGL context was lost or came back (the renderer device reports it; the composition root logs it). */
  onContext?: (event: "lost" | "restored") => void;
  /** Source of key, pointer, focus and visibility events for modifier tracking. */
  window?: Pick<Window, "addEventListener"> & { document?: Pick<Document, "addEventListener" | "visibilityState"> };
}) {
  const editors = new ViewportAdapter(options.surface ? ["surface"] : []);
  /** The head pane's one renderer device (profiles phase 4a-ii): made with the first head, kept for the window. */
  let device: SceneDevice & Pick<RendererDevice, "show" | "dispose"> | undefined;
  let disposed = false;
  /** The head shown on the device (several may be resident; the scene runtime owner decides which: preview/scene-residency.ts). */
  let viewer: Scene | undefined;
  /** Who else hears the context's loss and restore (the runtime owner drops warm runtimes on a loss). */
  const contextListeners = new Set<(event: "lost" | "restored") => void>();
  let surfaceEditor: SurfaceEditor | undefined;
  let releaseBinding: (() => void) | undefined;
  const resources = new Map<Scene, ReturnType<NonNullable<BrowserEditorAdapters["surface"]>["create"]>>();
  const resourcesFor = (scene: Scene) => {
    let made = resources.get(scene);
    if (!made && options.surface) resources.set(scene, made = options.surface.create(scene));
    return made;
  };
  // Each registered viewport host's element and the editor slot its input and capture belong to.
  const host = (_kind: ViewportHostKind) => options.headHost;
  const attachment = new ViewportAttachment<HTMLElement>({
    moveHost: (kind, slot) => {
      const node = host(kind);
      if (slot === node || node.contains(slot)) throw Error("A viewport cannot be hosted inside itself.");
      slot.append(node);
    },
    measure: kind => ({ width: host(kind).clientWidth, height: host(kind).clientHeight }),
    resize: kind => {
      if (kind === "head") viewer?.resize();
      editors.resize("surface");
    },
    cancelInput: () => editors.cancelInput("surface"),
    inputCapture: () => editors.capture()["surface"] ?? false,
    headView: () => viewer?.cameraState(),
    uvView: () => undefined, uvCommand: () => false,
    hitAt: (_kind, x, y) => surfaceEditor?.hitAt(x, y),
    queryContext: options.queryContext,
  }, ["head"]);
  // Held modifiers for hints and cursors. Key and pointer events both carry the live state (a
  // pointer event also resyncs after a key was released elsewhere); blur or a hidden page
  // clears them, so no modifier can stay stuck after the window loses focus.
  const events = options.window ?? (typeof window === "undefined" ? undefined : window);
  if (events) {
    const track = (event: Event) => attachment.reportModifiers(modifiersOf(event as KeyboardEvent));
    for (const type of ["keydown", "keyup", "pointermove", "pointerdown"]) events.addEventListener(type, track, { capture: true, passive: true, signal: options.signal });
    events.addEventListener("blur", () => attachment.reportModifiers(NO_MODIFIERS), { signal: options.signal });
    events.document?.addEventListener("visibilitychange", () => {
      if (events.document?.visibilityState === "hidden") attachment.reportModifiers(NO_MODIFIERS);
    }, { signal: options.signal });
  }
  /** The on-head editor goes with the head it edits: an open gesture is settled (cancelled), and its listeners leave the canvas. */
  function releaseEditor() {
    releaseBinding?.(); releaseBinding = undefined;
    editors.detach("surface");
    surfaceEditor = undefined;
    attachment.reportInput("head", { editable: false });
  }
  options.signal?.addEventListener("abort", () => { releaseEditor(); for (const item of resources.values()) item.dispose(); resources.clear(); }, { once: true });
  return {
    attachment,
    /**
     * Build a head with a body's core (the feminine V's by default), hidden on the pane's renderer device, whatever is shown meanwhile.
     * It rejects with `signal.reason` once the signal aborts (a newer subject or body change superseded it), having released what it made.
     */
    buildHead(body: CoreBody = "female", signal?: AbortSignal) {
      if (disposed) return Promise.reject(new DOMException("The viewport was closed.", "AbortError"));
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
      resources.get(scene)?.dispose(); resources.delete(scene);
      scene.dispose();
    },
    /**
     * What the on-head editor will add to `scene` once mounted on it (its guides), as stand-ins to compile with the head before it is shown,
     * so its first shown frame links nothing of theirs (profiles phase 4a-v-b). They live as long as the head, keeping those programs.
     */
    surfaceGuides(scene: Scene): readonly THREE.Object3D[] { return resourcesFor(scene)?.guides ?? []; },
    /**
     * The steps that make the on-head editor's parts for `surface` on `scene` ahead (its surface map and occlusion trees, tens of milliseconds
     * each), for a head prepared before it is shown: the editor mounted at show takes them made (profiles phase 4a-v-b).
     */
    surfaceSteps(scene: Scene, surface: THREE.SkinnedMesh): readonly (() => void)[] { return resourcesFor(scene)?.steps(surface) ?? []; },
    /** Hear the head pane's context being lost and coming back. Returns the unsubscribe. */
    onContext(listener: (event: "lost" | "restored") => void) { contextListeners.add(listener); return () => { contextListeners.delete(listener); }; },
    /** Mount the on-head editor over `surface` (the layered-makeup surface a feature renderer draws: eye makeup's plate), on the shown head. */
    mountSurface(surface: THREE.SkinnedMesh, binding: Omit<EditorBinding, "input">) {
      if (!viewer) throw Error("The head scene must be shown before mounting surface controls.");
      const prepared = resourcesFor(viewer);
      if (!prepared || binding.signal.aborted) return;
      surfaceEditor = prepared.mount(surface, { ...binding, input: state => attachment.reportInput("head", state) });
      editors.attach("surface", surfaceEditor);
      const mounted = surfaceEditor;
      const abort = () => { if (surfaceEditor === mounted) releaseEditor(); };
      binding.signal.addEventListener("abort", abort, { once: true });
      releaseBinding = () => binding.signal.removeEventListener("abort", abort);
      if (binding.signal.aborted) { releaseEditor(); return; }
      return surfaceEditor;
    },
    surfaceOutline(surface: THREE.SkinnedMesh) { return viewer ? resourcesFor(viewer)?.outline(surface) : undefined; },
    /** Unmount the on-head editor (its view stops being drawn on this head, or the head goes): an open gesture is settled (cancelled). */
    unmountSurface() { releaseEditor(); },
    headReady() { attachment.setReady("head"); },
    failHead(error: string) { attachment.setError("head", error); },
    headPending(phase: "loading" | "preparing" | "unavailable", message: string, progress: number | null = null) {
      attachment.setPending("head", phase, message, progress);
    },
    /** How far the head the drawn view wants is being built and prepared (null: none is); the pane shows it (phase 4a-v). */
    headPreparation(state: Parameters<ViewportAttachment<HTMLElement>["setPreparation"]>[1]) { attachment.setPreparation("head", state); },
    /** The recipe or selection changed: redraw the UV pane, and the head's next frame (its handles follow them). */
    drawUV() { viewer?.requestRender(); },
    capture() { return editors.capture(); },
    surfaceEditor() { return surfaceEditor; },
    scene() { return viewer; },
    /** The head owner releases its runtimes first; this owner then releases the shared renderer/context. */
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseEditor();
      for (const item of resources.values()) item.dispose();
      resources.clear(); contextListeners.clear(); viewer = undefined;
      device?.dispose(); device = undefined;
    },
  };
}
