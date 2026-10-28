import { AuthoringPreviewCoordinator } from "../preview/authoring-preview-coordinator";
import { AuthoringRenderScheduler, type PreviewLayerSource } from "../preview/authoring-render-scheduler";
import { canonicalFinish, isIrregular } from "../../../engines/layered-makeup/finish";
import { isDirectGlint } from "../../../engines/layered-makeup/direct-glint-settings";
import { maskAlphaKey, previewOpticalKey } from "../../../engines/layered-makeup/makeup-dependencies";
import { createRasterClient, type RasterPort } from "./raster-client";
import type { RasterResponse, GlitterStats } from "../../../engines/layered-makeup/raster-processor";
import type { Layer, Recipe } from "../../../engines/layered-makeup/recipe";
import { assessPreviewQuality, type PreviewTextureSize } from "../preview/preview-quality";
import type { RasterRegion } from "../../../engines/layered-makeup/region";
import type { ReadonlyDeep } from "../../../platform/api/read-only";
import type { LayeredMakeupSurface } from "../../../engines/layered-makeup/render/makeup-stack";

/** The layered-makeup surface the composition root connects (the live feature's renderer; UI-76). */
type Scene = LayeredMakeupSurface;
type CompleteRaster = Extract<RasterResponse, { data: unknown }>;
type PreviewOptics = NonNullable<CompleteRaster["optics"]>;
type PreviewAlbedo = NonNullable<CompleteRaster["albedo"]>;
type PendingOptics = { key: string; data?: PreviewOptics; albedo?: PreviewAlbedo };
/**
 * What a surface not shown now holds (profiles phase 4a-v): filled ahead of its show (`fillScene`), or left as it was when it stopped
 * being shown. Per slot, the canvas its mask texture reads, the layer it was given and the optical maps it was given them with. While a
 * surface holds a canvas, a completed mask is painted into a new canvas rather than over that one, so the surface keeps exactly what it
 * was filled with (a detached snapshot) until it is brought up to date. `look` is the look those layers are (the document's when held) and
 * `size` the tier they were rastered at: when the document shows that look again, the hold gives its masks and maps back (`showLook`).
 */
type HeldLayers = { accepted: boolean; look: string | undefined; size: number; ids: string[];
  slots: { canvas: HTMLCanvasElement; layer: string; optics: PendingOptics | undefined }[] };

export { previewOpticalKey };

/** Trusted browser resource owner. A replacement presentation receives quality actions, never these canvases or worker. */
export function createBrowserPreviewDevice(options: {
  signal?: AbortSignal;
  /** Where the surface's layers come from (the live feature's authoring document). */
  document: PreviewLayerSource;
  /**
   * Which look the document shows now, as a key (undefined: none, or unknown): what a surface's hold is tagged with, so a warm head's makeup
   * is given back when the document shows its look again (experiment 044 decision D3).
   */
  look?: () => string | undefined;
  /** The live feature's region (its mirror and fine-Glitter scope), for the raster worker and optical identities. */
  region: RasterRegion;
  initialSize: PreviewTextureSize;
  makeWorker(): RasterPort;
  frame(run: () => void): void;
  refresh(): void;
  refreshSelection(): void;
  refreshQuality(): void;
  drawUV(): void;
  report(message: string): void;
  measurement(layer: Layer, size: number, stats: GlitterStats): void;
  createCanvas?(size: number): HTMLCanvasElement;
  createPixels?(data: CompleteRaster["data"], size: number): ImageData;
}) {
  options.signal?.throwIfAborted();
  const { document: authoring } = options;
  const createCanvas = options.createCanvas ?? ((size: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    return canvas;
  });
  const createPixels = options.createPixels ?? ((data: CompleteRaster["data"], size: number) => new ImageData(data, size, size));
  const makeEmptyCanvas = () => createCanvas(1);
  const canvases = authoring.recipe.layers.map(makeEmptyCanvas);
  const emptyCanvases = () => authoring.recipe.layers.map(makeEmptyCanvas);
  /** Inputs actually painted into each canvas, independent of edits or work still in flight. Kept only as long as the canvas. */
  const rastered = new WeakMap<HTMLCanvasElement, string>();
  /** Each slot's latest optical maps, by their identity: what a surface connected or filled later is given with its mask. */
  let optics: (PendingOptics | undefined)[] = [];
  let viewer: Scene | undefined;
  let initialQuality: ReturnType<AuthoringPreviewCoordinator["assess"]> | undefined;
  /** The slots the connected surface still needs presented (`presentInitialLayers`): every one, or those changed since it was filled. */
  let presenting: number[] = [];
  const held = new Map<Scene, HeldLayers>();
  const isHeld = (canvas: HTMLCanvasElement) => { for (const entry of held.values()) if (entry.slots.some(slot => slot.canvas === canvas)) return true; return false; };
  let coordinator: AuthoringPreviewCoordinator;
  let scheduler: AuthoringRenderScheduler;
  const client = createRasterClient(options.makeWorker,
    (result, requested) => coordinator.publish(result, requested), reason => coordinator.fail(reason), options.region);
  const opticalKey = (layer: ReadonlyDeep<Layer>, size: number) => previewOpticalKey(layer, size, options.region.fineGlitter);
  coordinator = new AuthoringPreviewCoordinator(authoring, options.initialSize, {
    maxTextureSize: () => viewer?.maxTextureSize ?? 4096,
    resourceSize: i => canvases[i]?.width ?? 0,
    needsOptics: (i, layer, size) => viewer ? viewer.layers.needsOptics(i, layer, size)
      : !(optics[i]?.key === opticalKey(layer, size) && optics[i]?.data),
    needsPresentationMaps: (i, layer, size) => !!viewer &&
      (viewer.layers.needsOptics(i, layer, size) || viewer.layers.needsAlbedo(i, layer, size)),
    queue: () => client.diagnostics(),
    reset: () => client.reset(),
    replaceResources: () => {
      // Dispose the previous tier or stack before allocating its replacement.
      canvases.splice(0, canvases.length, ...emptyCanvases());
      optics = [];
      viewer?.layers.setCanvases(canvases, authoring.recipe.layers.map(layer => layer.id));
    },
    reconcileResources: (previous, current) => {
      // Worker slots are indices; old completions must not paint a moved identity.
      const pending = client.diagnostics();
      const interrupted = new Set([...(pending.running ? [pending.running.i] : []), ...pending.queuedIndices]
        .map(index => previous[index]?.id).filter((id): id is string => !!id));
      client.reset();
      const oldSlots = new Map(previous.map((layer, i) => [layer.id, i]));
      const priorCanvases = [...canvases], priorOptics = [...optics];
      canvases.splice(0, canvases.length, ...current.map(layer => {
        const old = oldSlots.get(layer.id);
        return old === undefined ? makeEmptyCanvas() : priorCanvases[old];
      }));
      optics = current.map(layer => {
        const old = oldSlots.get(layer.id);
        return old === undefined ? undefined : priorOptics[old];
      });
      viewer?.layers.reconcileLayerCanvases(current.map(layer => layer.id), canvases);
      return interrupted;
    },
    releaseDisabled: (i, layer) => {
      if (canvases[i].width !== 1) {
        canvases[i] = makeEmptyCanvas(); viewer?.layers.setLayerCanvas(i, canvases[i]);
      }
      optics[i] = undefined; viewer?.layers.updateLayer(i, layer);
    },
    request: (i, layer, priority, size, needsOptics) => client.request(i, layer, priority, size, needsOptics),
    updateLayer: (i, layer) => { viewer?.layers.updateLayer(i, layer); },
    publish: ({ i, data, size, optics: maps, albedo, glitterStats }, layer, painted) => {
      // A surface not shown holds this canvas: the new mask goes on a canvas of its own (HeldLayers).
      if (canvases[i].width !== size || isHeld(canvases[i])) {
        canvases[i] = createCanvas(size);
      }
      canvases[i].getContext("2d")!.putImageData(createPixels(data, size), 0, 0);
      rastered.set(canvases[i], JSON.stringify(painted));
      if (maps || albedo) {
        const key = opticalKey(layer, size), prior = optics[i];
        optics[i] = { key, data: maps ?? (prior?.key === key ? prior.data : undefined), albedo: albedo ?? (prior?.key === key ? prior.albedo : undefined) };
      }
      else if (!layer.enabled || !["shimmer", "glitter"].includes(canonicalFinish(layer.finish))) optics[i] = undefined;
      viewer?.layers.setLayerCanvas(i, canvases[i]);
      viewer?.layers.updateLayer(i, layer, maps, albedo, true);
      if (glitterStats && layer.finish === "glitter" && isIrregular(layer.flakes))
        options.measurement(layer, size, glitterStats);
      options.drawUV();
    },
    renderAll: order => scheduler.renderAll(order),
    refresh: options.refresh,
    refreshQuality: options.refreshQuality,
    report: options.report,
  });
  /** The layers as they are now, as a surface given them holds them. */
  const snapshot = (accepted: boolean): HeldLayers => ({ accepted, look: options.look?.(), size: coordinator.size, ids: authoring.recipe.layers.map(layer => layer.id),
    slots: authoring.recipe.layers.map((layer, i) => ({ canvas: canvases[i], layer: JSON.stringify(layer), optics: optics[i] })) });
  /**
   * Bring `scene`'s slots to the layers as they are now, and say which slots need presenting: from what it holds, only the slots whose
   * mask, layer or maps changed; without a usable hold (none, another stack, another tier), every slot afresh.
   */
  function bring(scene: Scene, accepted: boolean): number[] {
    const ids = authoring.recipe.layers.map(layer => layer.id), from = held.get(scene);
    if (!accepted || !from?.accepted || from.ids.length !== ids.length || from.ids.some((id, i) => id !== ids[i])) {
      scene.layers.setCanvases(accepted ? canvases : emptyCanvases(), ids);
      return ids.map((_, i) => i);
    }
    const changed: number[] = [];
    authoring.recipe.layers.forEach((layer, i) => {
      const slot = from.slots[i]!, canvas = slot.canvas !== canvases[i];
      if (canvas) scene.layers.setLayerCanvas(i, canvases[i]);
      if (canvas || slot.layer !== JSON.stringify(layer) || slot.optics !== optics[i]) changed.push(i);
    });
    return changed;
  }
  /** Give `scene` slot `i`'s layer with its mask and, when they match it, its optical maps. */
  function present(scene: Scene, i: number) {
    const layer = authoring.recipe.layers[i], stored = optics[i];
    if (layer.finish === "glitter" && (isIrregular(layer.flakes) || isDirectGlint(layer.flakes)) && canvases[i].width < 32) return;
    const valid = stored?.key === opticalKey(layer, canvases[i].width);
    scene.layers.updateLayer(i, layer, valid ? stored?.data : undefined, valid ? stored?.albedo : undefined, true);
  }
  scheduler = new AuthoringRenderScheduler(authoring, {
    frame: options.frame, render: i => coordinator.render(i), refreshSelection: options.refreshSelection,
  });
  const release = () => { scheduler.dispose(); client.dispose(); held.clear(); viewer = undefined; };
  options.signal?.addEventListener("abort", release, { once: true });
  if (options.signal?.aborted) { release(); options.signal.throwIfAborted(); }
  return {
    coordinator,
    canvases,
    emptyCanvases,
    queueDiagnostics: () => client.diagnostics(),
    /**
     * Connect a surface to be shown: it follows the layers from now on. A surface that holds layers already (filled ahead of its show, or
     * shown before) keeps them, and only the slots that changed since are brought up to date, so a prepared surface's first shown frame
     * compiles, composites and uploads nothing more; any other is given every layer.
     */
    connectScene(scene: Scene) {
      viewer = scene;
      initialQuality = coordinator.assess();
      presenting = bring(scene, initialQuality.accepted);
      held.delete(scene);
      if (!initialQuality.accepted) coordinator.rejectInitialCapacity();
      return initialQuality;
    },
    /** Forget an unloaded scene; layer work continues on the UV canvases. The surface keeps what it was given (HeldLayers). */
    disconnectScene(scene: Scene) {
      if (viewer !== scene) return;
      viewer = undefined;
      held.set(scene, snapshot(initialQuality?.accepted === true));
      initialQuality = undefined;
      presenting = [];
    },
    /** Publish the preloaded maps once saved appearance, pose and scene settings are restored. */
    presentInitialLayers() {
      if (!viewer) throw Error("The head scene must load before publishing preview layers.");
      if (!initialQuality) throw Error("The initial preview tier has not been assessed.");
      if (initialQuality.accepted) for (const i of presenting) present(viewer, i);
      presenting = [];
    },
    /**
     * Fill a surface that isn't shown with the layers as they are now (profiles phase 4a-v), so its scene is prepared with them: their
     * masks and maps uploaded and the merged plate composited before it is shown. It holds a detached snapshot (HeldLayers) until it is
     * connected, which brings it up to date; filling it again brings only what changed. The surface shown now is the live one already.
     */
    fillScene(scene: Scene) {
      if (scene === viewer) return;
      const accepted = assessPreviewQuality(authoring.recipe, coordinator.size, scene.maxTextureSize).accepted;
      const changed = bring(scene, accepted);
      if (accepted) for (const i of changed) present(scene, i);
      held.set(scene, snapshot(accepted));
    },
    /**
     * Whether `scene` holds the layers as they are now (profiles phase 4a-v, the surface's part of a warm head's readiness): the surface
     * shown is live; a surface not shown is current when connecting it would bring nothing, that is, its hold has the tier it would be given
     * now and, slot for slot, the layers, masks and optical maps there are now. A layer enabled, edited, added or removed, or a mask or maps
     * completed, since it was filled or hidden makes it stale: it is filled and prepared again before it is shown.
     */
    holdsCurrent(scene: Scene): boolean {
      if (scene === viewer) return true;
      const from = held.get(scene), layers = authoring.recipe.layers;
      if (!from || from.accepted !== assessPreviewQuality(authoring.recipe, coordinator.size, scene.maxTextureSize).accepted) return false;
      if (from.ids.length !== layers.length) return false;
      return layers.every((layer, i) => { const slot = from.slots[i]!;
        return from.ids[i] === layer.id && slot.canvas === canvases[i] && slot.optics === optics[i] && slot.layer === JSON.stringify(layer); });
    },
    /** A surface goes (its head is released): it holds nothing any more. */
    releaseScene(scene: Scene) { held.delete(scene); },
    /**
     * The document shows another look (experiment 044 decision D3). When a surface not shown holds that look's layers at this tier (a warm
     * head's, kept with it and released with it, so bounded by residency), its masks and maps become the device's again and only the layers
     * changed since are rastered: switching back to a warm look rasters, uploads and composites nothing. Otherwise (or while a surface is
     * connected: it is given every layer) every layer is rastered afresh, as before. Answers whether a hold was given back.
     */
    showLook(): boolean {
      const look = options.look?.(), size = coordinator.size;
      const from = viewer || look === undefined ? undefined : [...held.values()].find(entry => entry.look === look && entry.accepted && entry.size === size);
      if (!from) { coordinator.resetStack(); return false; }
      // Work queued for the look shown before must not paint the slots taken back (their indices name its layers).
      client.reset();
      canvases.splice(0, canvases.length, ...from.slots.map(slot => slot.canvas));
      optics = from.slots.map(slot => slot.optics);
      // A hold's layer is what was presented, which may be newer than its canvas. Compare against completed raster inputs instead.
      const incomplete = new Set<string>();
      const layers = from.slots.map((slot, i) => {
        const complete = rastered.get(slot.canvas);
        if (complete === undefined) incomplete.add(from.ids[i]!);
        return JSON.parse(complete ?? slot.layer) as Layer;
      });
      coordinator.syncStack({ layers } as Recipe, incomplete);
      return true;
    },
  };
}
