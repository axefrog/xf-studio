/**
 * Spike S2 (experiments/039-view-switch-spike, profiles design §9.1): the minimum needed to measure switching the drawn view. Mounted
 * only in a `?verify=1&spike=views` workspace (studio-startup.ts); nothing here runs by default and nothing here is product code.
 *
 * - **Two views of one scene:** the head's `PreviewActions.drawView` draws another view of the same scene (its camera, lights and display).
 * - **Two subjects:** a resident subject is a second scene host that draws with the shown head's renderer (one WebGL context, its program
 *   cache shared), with a character-detail service of its own. Showing a subject only changes which scene host draws into the canvas.
 *   It is a crude stand-in for the scene-runtime split: a scene host still owns its camera, controls, lighting stage and render targets.
 *
 * Instrumentation: each resident's detail loads and preparations are tracked, so the time a superseded preparation takes to stop is
 * measured where the work actually happens, not where the service stops waiting.
 */
import { createSceneHost, type SceneHost } from "../../platform/scene/scene-host";
import type { FeatureRendererFactory, SceneHostPort } from "../../platform/api/scene";
import type { CoreBody } from "../../character/render-detail";
import type { CharacterRequest } from "../../character/character-detail-request";
import { CharacterDetailActions } from "../../character/character-detail-actions";
import { createBrowserCharacterDetailDevice } from "../../character/browser/browser-character-detail-device";
import type { PreviewActions } from "../preview-actions";
import type { ViewGraph } from "../../platform/core/view-graph";

type Resident = { id: string; body: CoreBody; scene: SceneHost; details: CharacterDetailActions; inflight: Set<Promise<unknown>>;
  /** When the last tracked load or preparation settled (page clock). */
  settledAt: number; opened: number };

export function createSpikeViews(deps: {
  headHost: HTMLElement;
  main: () => SceneHost | undefined;
  preview: () => PreviewActions | undefined;
  graph: ViewGraph;
  renderers: readonly FeatureRendererFactory[];
  referenceTextures?: SceneHostPort["referenceTextures"];
  prepareCore(body: CoreBody): Promise<void>;
  /** The head pane's attachment state (pending phase, message, progress) as the presentation sees it. */
  head(): unknown;
}) {
  const residents = new Map<string, Resident>();
  let shown = "main";
  const track = (resident: Resident, work: Promise<unknown>) => {
    resident.inflight.add(work);
    const done = () => { resident.inflight.delete(work); resident.settledAt = performance.now(); };
    work.then(done, done);
    return work;
  };
  const drawOnly = (id: string) => {
    const main = deps.main();
    for (const [key, resident] of residents) if (key !== id) resident.scene.setDrawing(false);
    if (id !== "main") main?.setDrawing(false);
    (id === "main" ? main : residents.get(id)?.scene)?.setDrawing(true);
    shown = id;
  };
  return {
    // ----- Two views of one scene -----
    graph: deps.graph,
    drawView: (view: string) => deps.preview()?.drawView(view),
    drawnView: () => deps.preview()?.drawnView(),
    /** A view action on the head's preview service (camera, lights, display), naming its view. */
    dispatch: (action: Parameters<PreviewActions["dispatch"]>[0]) => deps.preview()?.dispatch(action),
    // ----- Resident subjects -----
    /**
     * Open a resident subject: a scene host of `body` on the shown head's renderer, hidden, showing `request`. Resolves once the scene
     * exists (the details follow; `status(id)` reports them). `fresh`: false reuses a resident of that ID.
     */
    async open(id: string, body: CoreBody, request: CharacterRequest, options: { renderers?: boolean } = {}) {
      const main = deps.main();
      if (!main) throw Error("No head is loaded.");
      if (residents.has(id)) throw Error(`${id} is already open.`);
      const t0 = performance.now();
      await deps.prepareCore(body);
      const scene = await createSceneHost(deps.headHost, { body, sharedRenderer: main.renderer, referenceTextures: deps.referenceTextures,
        renderers: options.renderers === false ? [] : deps.renderers });
      scene.setDrawing(false);
      const resident: Resident = { id, body, scene, details: undefined!, inflight: new Set(), settledAt: 0, opened: performance.now() - t0 };
      const details = scene.details, load = details.load.bind(details);
      details.load = ((...args: Parameters<typeof load>) => track(resident, load(...args))) as typeof details.load;
      const prepare = scene.prepareDetails;
      (scene as { prepareDetails: typeof prepare }).prepareDetails = (loaded, signal) => track(resident, prepare(loaded, signal)) as ReturnType<typeof prepare>;
      resident.details = new CharacterDetailActions(createBrowserCharacterDetailDevice(scene));
      residents.set(id, resident);
      void resident.details.setCharacter(request);
      return { opened: Math.round(resident.opened) };
    },
    /** Ask a resident for another request (a change, or another V on the same body). */
    set: (id: string, request: CharacterRequest) => { void residents.get(id)?.details.setCharacter(request); },
    /** Draw `id` (a resident, or `main`: the head the Studio loaded) and nothing else. */
    show: (id: string) => drawOnly(id),
    shown: () => shown,
    status: (id: string) => {
      const resident = residents.get(id);
      if (!resident) return null;
      const status = resident.details.snapshot();
      return { phase: status.phase, updating: status.updating, progress: status.progress, inflight: resident.inflight.size,
        settledAt: resident.settledAt, frames: resident.scene.frameTiming().frames, opened: Math.round(resident.opened) };
    },
    /** Supersede a resident's preparation: its service stops following and its loader stops at its next part. */
    cancel(id: string) {
      const resident = residents.get(id);
      if (!resident) return null;
      const t = performance.now();
      resident.details.dispose();
      return t;
    },
    /** Close a resident: its scene, details and GPU resources released (the shared renderer stays). */
    close(id: string) {
      const resident = residents.get(id);
      if (!resident) return;
      if (shown === id) drawOnly("main");
      resident.details.dispose();
      resident.scene.setCharacterDetails(null);
      resident.scene.dispose();
      residents.delete(id);
    },
    head: () => deps.head(),
    mainBody: () => deps.main()?.body ?? null,
    frames: (id: string) => (id === "main" ? deps.main() : residents.get(id)?.scene)?.frameTiming() ?? null,
    memory: () => {
      const main = deps.main();
      return { renderer: main ? { ...main.renderer.info.memory, programs: main.renderer.info.programs?.length ?? 0 } : null,
        heap: (performance as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory?.usedJSHeapSize ?? null };
    },
  };
}
