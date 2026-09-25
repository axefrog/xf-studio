/**
 * Render on demand for the 3D head (UI-38). A frame is drawn only when something visible changed (the
 * dirty flag, set through `invalidate`) or while something moves by itself (`animating`: idle playback,
 * the blink study). Orbit damping needs no special case: each damped step changes the camera, the controls
 * report the change, and that sets the flag for the next frame. When neither holds, the frame loop stops,
 * so an idle viewport costs no GPU work and no per-frame script time. Renderer-free and DOM-free.
 */
export type FrameClock = {
  request(callback: () => void): number;
  cancel(handle: number): void;
  now(): number;
};
export type RenderSchedulerOptions = {
  clock: FrameClock;
  /** Advance and draw one frame; `dt` is seconds since the previous frame (or since the request that woke the loop). */
  frame(dt: number, now: number): void;
  /** Whether something keeps changing without further requests. */
  animating(): boolean;
};
export type FrameSummary = { samples: number; medianMs: number; p95Ms: number };
export type RenderStats = {
  /** Frames drawn since the scene started. */
  frames: number;
  /** Requests for a frame (several before one frame count once each). */
  requests: number;
  /** Whether the loop is scheduled right now (false means the viewport is idle and draws nothing). */
  running: boolean;
  /** Intervals between consecutive frames of one run, and the time each frame took on the main thread. */
  interval: FrameSummary;
  cpuFrame: FrameSummary;
  /** Milliseconds since the last frame was drawn. */
  sinceLastFrameMs: number;
};

/** A fixed-size ring of recent samples; records without allocating. */
class Samples {
  private readonly values: Float64Array;
  private count = 0;
  private next = 0;
  constructor(size: number) { this.values = new Float64Array(size); }
  record(value: number) {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
  }
  summary(): FrameSummary {
    const ordered = Array.from(this.values.subarray(0, this.count)).sort((a, b) => a - b);
    return { samples: ordered.length, medianMs: ordered[Math.floor(ordered.length * .5)] ?? 0, p95Ms: ordered[Math.floor(ordered.length * .95)] ?? 0 };
  }
}

export type RenderScheduler = {
  /** Something visible changed: draw one more frame (coalesced with any pending one). */
  invalidate(): void;
  readonly running: boolean;
  stats(): RenderStats;
  /** Stop for good; later requests do nothing. */
  dispose(): void;
};

export function createRenderScheduler(options: RenderSchedulerOptions): RenderScheduler {
  const { clock } = options;
  const intervals = new Samples(180), durations = new Samples(180);
  let dirty = false, handle = 0, scheduled = false, disposed = false;
  let frames = 0, requests = 0, previous = clock.now(), lastFrameAt = previous, continuous = false;

  function tick() {
    scheduled = false; handle = 0;
    if (disposed) return;
    const now = clock.now(), dt = Math.max(0, (now - previous) / 1000);
    if (continuous) intervals.record(now - previous);
    previous = now;
    // Cleared before drawing: a request made while this frame runs (a damped orbit step) asks for the next one.
    dirty = false;
    try { options.frame(dt, now); }
    finally {
      frames++;
      lastFrameAt = clock.now();
      durations.record(lastFrameAt - now);
      continuous = dirty || options.animating();
      if (continuous && !disposed) schedule();
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    handle = clock.request(tick);
  }
  return {
    invalidate() {
      if (disposed) return;
      requests++;
      dirty = true;
      if (scheduled) return;
      // Waking from idle: the first frame's dt runs from this request, not from the last frame drawn.
      previous = clock.now();
      schedule();
    },
    get running() { return scheduled; },
    stats: () => ({ frames, requests, running: scheduled, interval: intervals.summary(), cpuFrame: durations.summary(),
      sinceLastFrameMs: clock.now() - lastFrameAt }),
    dispose() {
      disposed = true;
      if (scheduled) clock.cancel(handle);
      scheduled = false;
    },
  };
}

/** What can change the picture without going through the scene's own methods. */
export type RenderTriggerSources = {
  /** Orbit controls: `change` fires on every camera step, including each damped step after release. */
  controls: { addEventListener(type: "change", listener: () => void): void; removeEventListener(type: "change", listener: () => void): void };
  /** The viewport canvas: pointer and wheel input (hover highlights, handle drags) and a restored GL context. */
  element: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  /** Lighting preset device: preset, body and colour-grade changes (the LUT arrives asynchronously). */
  lighting?: { subscribe(listener: () => void): () => unknown };
};
export const CANVAS_TRIGGERS = ["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerleave", "wheel", "webglcontextrestored"] as const;

/** Connect the event sources to `invalidate`; returns the disconnect. */
export function bindRenderTriggers(invalidate: () => void, sources: RenderTriggerSources): () => void {
  const listener = () => invalidate();
  sources.controls.addEventListener("change", listener);
  for (const type of CANVAS_TRIGGERS) sources.element.addEventListener(type, listener, { passive: true });
  const unsubscribe = sources.lighting?.subscribe(listener);
  return () => {
    sources.controls.removeEventListener("change", listener);
    for (const type of CANVAS_TRIGGERS) sources.element.removeEventListener(type, listener);
    unsubscribe?.();
  };
}

/** Wrap each named method so a call also requests a frame (after it ran, whatever it returned). */
export function invalidating<T extends object, K extends keyof T>(target: T, keys: readonly K[], invalidate: () => void): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) {
    const method = target[key];
    if (typeof method !== "function") throw Error(`${String(key)} is not a method.`);
    out[key] = ((...args: unknown[]) => {
      try { return (method as (...a: unknown[]) => unknown).apply(target, args); }
      finally { invalidate(); }
    }) as T[K];
  }
  return out;
}
