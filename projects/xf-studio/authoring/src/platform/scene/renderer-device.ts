import * as THREE from "three";
import { HeadLoadError } from "../../preview/head-load-error";
import { bindRenderTriggers, createRenderScheduler, type RenderStats } from "../../preview/render/render-scheduler";
import { viewportPixelRatio, watchDevicePixelRatio } from "../../preview/render/device-pixel-ratio";
import { linearTargetSupported } from "../../preview/render/linear-display";
import { visibleViewportSize } from "../../preview/viewport-size";

/**
 * The renderer device (profiles phase 4a-ii, experiments/043-scene-runtimes): one per window's 3D pane. It owns the canvas, the one WebGL
 * context and `WebGLRenderer`, the one render-on-demand scheduler, the pane's size and device pixel ratio, the context's loss and restore,
 * and the canvas as the input element. Scene runtimes (scene-host.ts) are built on it, hidden, and it draws only the one it shows: a
 * runtime that isn't shown never reaches the canvas, its frame requests wait until it is shown, and camera input reaches only the shown
 * runtime's camera (each runtime attaches its controls while shown and lets go when hidden).
 *
 * Runtimes own what they make on the renderer and free it themselves; the device never disposes a runtime's objects, and a runtime never
 * disposes the device. With nothing shown the canvas is hidden, so the pane looks as it did when a head was released with its own context.
 */

/** What a scene runtime lends the device: how to draw it and how to hand it the canvas while it is shown. */
export type DrawnScene = {
  /** Advance and draw one frame (`dt` in seconds); called only while shown, with the drawing buffer at the device's size. */
  draw(dt: number): void;
  /** Whether it keeps changing without further requests (the idle, the blink, a settling camera). */
  animating(): boolean;
  /** It is shown: take the canvas for camera input. */
  attach(canvas: HTMLCanvasElement): void;
  /** It is hidden: let go of the canvas (nothing of it may act on input any more). */
  detach(): void;
  /** The visible pane's size (CSS pixels), on show and on every resize while shown. */
  resized(width: number, height: number): void;
  /** The context came back: rebuild what lived only on the GPU (every resident runtime hears it). */
  contextRestored(): void;
};

/** A runtime's place on the device. */
export type DeviceSlot = {
  /** Something it draws changed: a frame now if it is shown, else when it is next shown. */
  requestFrame(): void;
  readonly shown: boolean;
  /** Frames drawn of this runtime. */
  readonly frames: number;
  /** It goes (its owner is disposing it): hidden first if shown. Never touches the renderer. */
  remove(): void;
};

export type RendererDeviceOptions = {
  /** Told when the WebGL context is lost and when it comes back (the diagnostics log records both; docs/diagnostics.md). */
  onContext?: (event: "lost" | "restored") => void;
  /**
   * Draw on this WebGL 2 context instead of opening one (probes wrap a context's calls to count its GPU objects before Three uses it).
   * It must have been made as the device makes its own: opaque, preserving its drawing buffer.
   */
  context?: WebGL2RenderingContext;
};

export type RendererDevice = ReturnType<typeof createRendererDevice>;

/**
 * Open the device in `host`, its canvas first in it. Throws `HeadLoadError("webgl_unavailable")` when WebGL 2 can't start (nothing is left
 * in the page then).
 */
export function createRendererDevice(host: HTMLElement, options: RendererDeviceOptions = {}) {
  const renderer = openRenderer(options.context);
  const canvas = renderer.domElement;
  canvas.style.display = "none";
  host.prepend(canvas);
  renderer.setPixelRatio(viewportPixelRatio(devicePixelRatio));
  const releases: (() => void)[] = [() => { renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); }];
  type Entry = { scene: DrawnScene; slot: DeviceSlot; frames: number };
  const entries = new Set<Entry>();
  let shown: Entry | null = null, disposed = false;
  let width = 0, height = 0;
  /** Bring the drawing buffer to the pane's size; false while the pane is hidden or has no size. */
  const resize = () => {
    const size = visibleViewportSize(host.clientWidth, host.clientHeight);
    if (!size) return false;
    if (size.width !== width || size.height !== height) {
      renderer.setSize(size.width, size.height);
      width = size.width; height = size.height;
    }
    shown?.scene.resized(size.width, size.height);
    return true;
  };
  const scheduler = createRenderScheduler({
    clock: { request: callback => requestAnimationFrame(callback), cancel: handle => cancelAnimationFrame(handle), now: () => performance.now() },
    animating: () => shown?.scene.animating() ?? false,
    frame(dt) {
      if (!shown) return;
      shown.frames++;
      shown.scene.draw(dt);
    },
  });
  const invalidate = () => { if (shown) scheduler.invalidate(); };
  releases.push(() => scheduler.dispose());
  // Pointer and wheel input on the canvas (hover highlights, handle drags) and a restored context draw the shown runtime.
  releases.push(bindRenderTriggers(invalidate, { element: canvas }));
  const restored = () => {
    options.onContext?.("restored");
    for (const entry of [...entries]) entry.scene.contextRestored();
  };
  const lost = () => options.onContext?.("lost");
  canvas.addEventListener("webglcontextrestored", restored);
  canvas.addEventListener("webglcontextlost", lost);
  releases.push(() => { canvas.removeEventListener("webglcontextrestored", restored); canvas.removeEventListener("webglcontextlost", lost); });
  const observer = new ResizeObserver(() => { resize(); invalidate(); });
  observer.observe(host);
  releases.push(() => observer.disconnect());
  // A monitor move or page zoom changes the device pixel ratio without resizing the host (UI-46).
  releases.push(watchDevicePixelRatio(window, pixelRatio => { renderer.setPixelRatio(pixelRatio); resize(); invalidate(); }));

  function show(entry: Entry | null) {
    if (disposed || entry === shown) return;
    shown?.scene.detach();
    shown = entry;
    canvas.style.display = entry ? "" : "none";
    if (!entry) return;
    entry.scene.attach(canvas);
    resize();
    scheduler.invalidate();
  }
  const slots = new WeakMap<DeviceSlot, Entry>();
  return {
    renderer,
    /** The canvas the shown runtime draws to and takes input from. */
    canvas,
    /** The pane's size now (CSS pixels; zero while it is hidden): what framing measures its aspect from. */
    measure: () => ({ width: host.clientWidth, height: host.clientHeight }),
    /** Bring the canvas to the pane's size now (after the pane moved); false while it is hidden. */
    resize,
    /** Add a runtime, hidden. Its owner removes it when the runtime goes. */
    add(scene: DrawnScene): DeviceSlot {
      const entry: Entry = { scene, frames: 0, slot: {
        requestFrame: () => { if (shown === entry) scheduler.invalidate(); },
        get shown() { return shown === entry; },
        get frames() { return entry.frames; },
        remove: () => {
          if (!entries.delete(entry)) return;
          if (shown === entry) show(null);
        },
      } };
      entries.add(entry);
      slots.set(entry.slot, entry);
      return entry.slot;
    },
    /** Draw this runtime (null: none, and the canvas hides). The one shown before lets go of the canvas first. */
    show(slot: DeviceSlot | null) {
      const entry = slot ? slots.get(slot) : null;
      if (slot && (!entry || !entries.has(entry))) throw Error("That scene isn't on this renderer device.");
      show(entry ?? null);
    },
    /** Frames drawn, requests and recent frame timings for the device's loop; `running: false` means it draws nothing now. */
    stats: (): RenderStats => scheduler.stats(),
    /** Close the device: the renderer, its context and the canvas. Its runtimes must have gone first. */
    dispose() {
      if (disposed) return;
      show(null);
      disposed = true;
      entries.clear();
      for (const release of releases.splice(0).reverse()) { try { release(); } catch { /* Best effort: the rest still run. */ } }
    },
  };
}

/**
 * The renderer on an opaque canvas: the stage is drawn in the scene (viewport-backdrop.ts), and the drawing buffer has no alpha channel,
 * so fragments that write alpha below one (alpha-to-coverage hair, decals) cannot reveal the page behind the canvas. Three always requests
 * an alpha channel for its own context (its `alpha: false` only clears alpha to one), so the context is made here. Every lighting setup
 * draws through a multisampled scene-linear target (linear-display.ts), so the canvas itself needs neither multisampling nor depth; without
 * a renderable half-float buffer the studio stage draws straight to the canvas, which then gets both back.
 */
function openRenderer(given?: WebGL2RenderingContext): THREE.WebGLRenderer {
  const open = (direct: boolean) => {
    const canvas = document.createElement("canvas");
    return { canvas, direct, context: canvas.getContext("webgl2", {
      alpha: false, antialias: direct, depth: direct, stencil: false, preserveDrawingBuffer: true }) };
  };
  let opened: { canvas: HTMLCanvasElement; direct: boolean; context: WebGL2RenderingContext | null };
  if (given) opened = { canvas: given.canvas as HTMLCanvasElement, direct: !linearTargetSupported(given), context: given };
  else {
    opened = open(false);
    if (opened.context && !linearTargetSupported(opened.context)) {
      opened.context.getExtension("WEBGL_lose_context")?.loseContext();
      opened = open(true);
    }
  }
  const { canvas, context } = opened;
  if (!context) throw new HeadLoadError("webgl_unavailable", "WebGL 2 is unavailable");
  try { return new THREE.WebGLRenderer({ canvas, context, antialias: opened.direct, depth: opened.direct, preserveDrawingBuffer: true }); }
  catch (error) { throw new HeadLoadError("webgl_unavailable", "WebGL 2 could not start", { cause: error }); }
}
