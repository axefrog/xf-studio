import type { AuthoringDocument } from "./authoring-document";
import { AuthoringPreviewCoordinator } from "./authoring-preview-coordinator";
import { AuthoringRenderScheduler } from "./authoring-render-scheduler";
import { canonicalFinish, defaultFlakes, isIrregular } from "./finish";
import { isDirectGlint } from "./direct-glint-settings";
import { maskAlphaKey, studioIrregularOpticalKey } from "./makeup-dependencies";
import { createRasterClient, type RasterPort } from "./raster-client";
import type { RasterResponse, GlitterStats } from "./raster-processor";
import type { Layer } from "./recipe";
import type { PreviewTextureSize } from "./preview-quality";
import type { ReadonlyDeep } from "./read-only";
import type { createScene } from "./scene";

type Scene = Awaited<ReturnType<typeof createScene>>;
type CompleteRaster = Extract<RasterResponse, { data: unknown }>;
type PreviewOptics = NonNullable<CompleteRaster["optics"]>;
type PreviewAlbedo = NonNullable<CompleteRaster["albedo"]>;
type PendingOptics = { key: string; data?: PreviewOptics; albedo?: PreviewAlbedo };

export function previewOpticalKey(layer: ReadonlyDeep<Layer>, size: number) {
  return isIrregular(layer.flakes) && layer.finish === "glitter"
    ? studioIrregularOpticalKey(layer.flakes, size)
    : JSON.stringify([canonicalFinish(layer.finish), layer.flakes ?? defaultFlakes(), size]);
}

/** Trusted browser resource owner. A replacement presentation receives quality actions, never these canvases or worker. */
export function createBrowserPreviewDevice(options: {
  document: AuthoringDocument;
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
  let initialOptics: (PendingOptics | undefined)[] = [];
  let viewer: Scene | undefined;
  let initialQuality: ReturnType<AuthoringPreviewCoordinator["assess"]> | undefined;
  let coordinator: AuthoringPreviewCoordinator;
  let scheduler: AuthoringRenderScheduler;
  const client = createRasterClient(options.makeWorker,
    result => coordinator.publish(result), reason => coordinator.fail(reason));
  coordinator = new AuthoringPreviewCoordinator(authoring, options.initialSize, {
    maxTextureSize: () => viewer?.renderer.capabilities.maxTextureSize ?? 4096,
    resourceSize: i => canvases[i]?.width ?? 0,
    needsOptics: (i, layer, size) => viewer ? viewer.needsOptics(i, layer, size)
      : initialOptics[i]?.key !== previewOpticalKey(layer, size),
    needsPresentationMaps: (i, layer, size) => !!viewer &&
      (viewer.needsOptics(i, layer, size) || viewer.needsAlbedo(i, layer, size)),
    queue: () => client.diagnostics(),
    reset: () => client.reset(),
    replaceResources: () => {
      // Dispose the previous tier or stack before allocating its replacement.
      canvases.splice(0, canvases.length, ...emptyCanvases());
      initialOptics = [];
      viewer?.setLayerCanvases(canvases, authoring.recipe.layers.map(layer => layer.id));
    },
    reconcileResources: (previous, current) => {
      // Worker slots are indices; old completions must not paint a moved identity.
      client.reset();
      const oldSlots = new Map(previous.map((layer, i) => [layer.id, i]));
      const priorCanvases = [...canvases], priorOptics = [...initialOptics];
      canvases.splice(0, canvases.length, ...current.map(layer => {
        const old = oldSlots.get(layer.id);
        return old === undefined ? makeEmptyCanvas() : priorCanvases[old];
      }));
      initialOptics = current.map(layer => {
        const old = oldSlots.get(layer.id);
        return old === undefined ? undefined : priorOptics[old];
      });
      viewer?.reconcileLayerCanvases(current.map(layer => layer.id), canvases);
    },
    releaseDisabled: (i, layer) => {
      if (canvases[i].width !== 1) {
        canvases[i] = makeEmptyCanvas(); viewer?.setLayerCanvas(i, canvases[i]);
      }
      initialOptics[i] = undefined; viewer?.updateLayer(i, layer);
    },
    request: (i, layer, priority, size, needsOptics) => client.request(i, layer, priority, size, needsOptics),
    updateLayer: (i, layer) => { viewer?.updateLayer(i, layer); },
    publish: ({ i, data, size, optics, albedo, glitterStats }, layer) => {
      if (canvases[i].width !== size) {
        canvases[i] = createCanvas(size);
      }
      canvases[i].getContext("2d")!.putImageData(createPixels(data, size), 0, 0);
      viewer?.setLayerCanvas(i, canvases[i]);
      if (viewer) { viewer.updateLayer(i, layer, optics, albedo, true); initialOptics[i] = undefined; }
      else if (optics || albedo) {
        const key = previewOpticalKey(layer, size), prior = initialOptics[i];
        initialOptics[i] = { key, data: optics ?? (prior?.key === key ? prior.data : undefined), albedo };
      }
      else if (!layer.enabled || !["shimmer", "glitter"].includes(canonicalFinish(layer.finish))) initialOptics[i] = undefined;
      if (glitterStats && layer.finish === "glitter" && isIrregular(layer.flakes))
        options.measurement(layer, size, glitterStats);
      options.drawUV();
    },
    renderAll: order => scheduler.renderAll(order),
    refresh: options.refresh,
    refreshQuality: options.refreshQuality,
    report: options.report,
  });
  scheduler = new AuthoringRenderScheduler(authoring, {
    frame: options.frame, render: i => coordinator.render(i), refreshSelection: options.refreshSelection,
  });
  return {
    coordinator,
    canvases,
    emptyCanvases,
    queueDiagnostics: () => client.diagnostics(),
    /** Connect after the scene discovers its actual texture limit. */
    connectScene(scene: Scene) {
      viewer = scene;
      initialQuality = coordinator.assess();
      scene.setLayerCanvases(initialQuality.accepted ? canvases : emptyCanvases(),
        authoring.recipe.layers.map(layer => layer.id));
      if (!initialQuality.accepted) coordinator.rejectInitialCapacity();
      return initialQuality;
    },
    /** Publish the preloaded maps once saved appearance, pose and scene settings are restored. */
    presentInitialLayers() {
      if (!viewer) throw Error("The head scene must load before publishing preview layers.");
      if (!initialQuality) throw Error("The initial preview tier has not been assessed.");
      for (let i = 0; i < authoring.recipe.layers.length; i++) {
        const layer = authoring.recipe.layers[i], stored = initialOptics[i];
        if (initialQuality.accepted && !(layer.finish === "glitter" &&
          (isIrregular(layer.flakes) || isDirectGlint(layer.flakes)) && canvases[i].width < 32)) {
          const valid = stored?.key === previewOpticalKey(layer, canvases[i].width);
          viewer.updateLayer(i, layer, valid ? stored?.data : undefined,
            valid ? stored?.albedo : undefined, true);
        }
        initialOptics[i] = undefined;
      }
    },
  };
}
