import { createScene } from "./scene";
import { createSurfaceEditor } from "./surface-editor";
import { createUVEditor } from "./uv-editor";
import { modifiersOf, NO_MODIFIERS } from "./input-bindings";
import { ViewportAdapter } from "./viewport-adapter";
import { ViewportAttachment, type ViewportAttachmentPort } from "./viewport-attachment";

type Scene = Awaited<ReturnType<typeof createScene>>;
type UVEditor = ReturnType<typeof createUVEditor>;
type SurfaceEditor = ReturnType<typeof createSurfaceEditor>;

/** Browser resource owner. The presentation receives only `attachment`, never these handles. */
export function createBrowserViewportDevice(options: {
  headHost: HTMLElement;
  uvHost: HTMLElement;
  queryContext: ViewportAttachmentPort<HTMLElement>["queryContext"];
  sceneFactory?: typeof createScene;
  uvFactory?: typeof createUVEditor;
  surfaceFactory?: typeof createSurfaceEditor;
  /** Source of key, pointer, focus and visibility events for modifier tracking. */
  window?: Pick<Window, "addEventListener"> & { document?: Pick<Document, "addEventListener" | "visibilityState"> };
}) {
  const editors = new ViewportAdapter();
  let viewer: Scene | undefined;
  let uvEditor: UVEditor | undefined;
  let surfaceEditor: SurfaceEditor | undefined;
  const host = (kind: "head" | "uv") => kind === "head" ? options.headHost : options.uvHost;
  const attachment = new ViewportAttachment<HTMLElement>({
    moveHost: (kind, slot) => {
      const node = host(kind);
      if (slot === node || node.contains(slot)) throw Error("A viewport cannot be hosted inside itself.");
      slot.append(node);
    },
    measure: kind => ({ width: host(kind).clientWidth, height: host(kind).clientHeight }),
    resize: kind => {
      if (kind === "head") { viewer?.resize(); editors.resize("surface"); }
      else editors.resize("uv");
    },
    cancelInput: kind => editors.cancelInput(kind === "head" ? "surface" : "uv"),
    inputCapture: kind => editors.capture()[kind === "head" ? "surface" : "uv"],
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
  return {
    attachment,
    mountUV(canvas: HTMLCanvasElement, controls: Parameters<typeof createUVEditor>[1],
      hooks: Parameters<typeof createUVEditor>[2], initial: Parameters<typeof createUVEditor>[3]) {
      uvEditor = (options.uvFactory ?? createUVEditor)(canvas, controls,
        { ...hooks, input: state => attachment.reportInput("uv", state) }, initial);
      editors.attach("uv", uvEditor);
      attachment.setReady("uv");
      return uvEditor;
    },
    async loadHead(canvases: HTMLCanvasElement[]) {
      this.unloadHead();
      viewer = await (options.sceneFactory ?? createScene)(options.headHost, canvases);
      return viewer;
    },
    /** Releases the loaded head: its surface editor, then the scene's renderer and canvas. */
    unloadHead() {
      editors.detach("surface");
      surfaceEditor = undefined;
      const loaded = viewer;
      viewer = undefined;
      loaded?.dispose();
    },
    mountSurface(hooks: Parameters<typeof createSurfaceEditor>[1]) {
      if (!viewer) throw Error("The head scene must load before mounting surface controls.");
      surfaceEditor = (options.surfaceFactory ?? createSurfaceEditor)(viewer,
        { ...hooks, input: state => attachment.reportInput("head", state) });
      editors.attach("surface", surfaceEditor);
      return surfaceEditor;
    },
    headReady() { attachment.setReady("head"); },
    failHead(error: string) { attachment.setError("head", error); },
    headPending(phase: "loading" | "preparing" | "unavailable", message: string, progress: number | null = null) {
      attachment.setPending("head", phase, message, progress);
    },
    drawUV() { uvEditor?.draw(); },
    capture() { return editors.capture(); },
    uvEditor() { return uvEditor; },
    surfaceEditor() { return surfaceEditor; },
    scene() { return viewer; },
  };
}
