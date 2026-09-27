/**
 * The preview worker (choice-previews-design.md §6.1): one WebGL 2 context on an OffscreenCanvas, off the main thread, drawing one
 * preview source at a time (choice-preview-render.ts). Messages: `subject` loads the head every preview is drawn over; `render` draws
 * a source (or, with `frames`, its turntable strip) and answers its WebP and timings. `live` keeps one source uploaded for the picture
 * being turned and `live-frame` answers it at any angle as an ImageBitmap; live messages don't wait behind drawings (each GL step is
 * synchronous, so a frame fits between a drawing's awaits), and a newer `live` or `live-stop` replaces or drops the one before. A lost context fails the job with `lost`, and the next job makes a new context once.
 */
import { parsePreviewSource } from "./choice-preview";
import { type LoadedSource, PreviewRenderer, type PreviewSubject } from "./choice-preview-render";

export type PreviewWorkerRequest =
  | { type: "subject"; id: number; url: string; head: string; eyes: string | null }
  | { type: "render"; id: number; source: unknown; fileBase: string;
      /** Draw the turntable strip of this many frames instead of the still (choice-preview.ts `TURNTABLE`). */
      frames?: number }
  | { type: "live"; id: number; source: unknown; fileBase: string }
  | { type: "live-frame"; id: number; turn: number;
      /** Also wait for the GPU and answer how long that took (measurement). */
      measure?: boolean }
  | { type: "live-stop"; id: number };
export type PreviewWorkerReply =
  | { id: number; ok: true; webp?: Blob; timings?: unknown; heap?: number;
      /** A live frame, how long drawing it took on the worker, and (when measured) with the GPU waited for. */
      bitmap?: ImageBitmap; ms?: number; gpuMs?: number }
  | { id: number; ok: false; error: string; lost?: boolean;
      /** A `live` load a newer `live` or `live-stop` replaced before it finished: not a failure of that source (PREV-151). */
      superseded?: boolean };

const scope = self as unknown as { postMessage(message: PreviewWorkerReply, transfer?: Transferable[]): void; onmessage: ((event: MessageEvent<PreviewWorkerRequest>) => void) | null };
const fetchFile = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw Error(`A preview file couldn't be read (${response.status}).`);
  return response.arrayBuffer();
};
let renderer: PreviewRenderer | null = null, subject: PreviewSubject | null = null, recreated = false;
function ready(): PreviewRenderer {
  if (renderer && !renderer.contextLost) return renderer;
  if (renderer) { if (recreated) throw Object.assign(Error("The preview context was lost again."), { lost: true }); recreated = true; live = { serial: live.serial + 1 }; renderer.dispose(); }
  renderer = new PreviewRenderer(new OffscreenCanvas(1, 1), fetchFile);
  if (subject) renderer.setSubject(subject);
  return renderer;
}
let queue = Promise.resolve();
/** The live turn: its serial (a newer `live` or `live-stop` supersedes it) and, once uploaded, its source and frame function. */
let live: { serial: number; loaded?: LoadedSource; present?: (turn: number) => ImageBitmap } = { serial: 0 };
function dropLive() { if (live.loaded) renderer?.release(live.loaded); live = { serial: live.serial + 1 }; }
async function liveMessage(message: Extract<PreviewWorkerRequest, { type: "live" | "live-frame" | "live-stop" }>) {
  try {
    if (message.type === "live-stop") { dropLive(); scope.postMessage({ id: message.id, ok: true }); return; }
    if (message.type === "live") {
      dropLive();
      const serial = live.serial, drawer = ready();
      const loaded = await drawer.load(parsePreviewSource(message.source), file => `${message.fileBase}${file}?background=1`);
      if (serial !== live.serial || drawer !== renderer) { drawer.release(loaded); throw Object.assign(Error("A newer turn replaced this one."), { superseded: true }); }
      live = { serial, loaded, present: drawer.present(loaded) };
      scope.postMessage({ id: message.id, ok: true });
      return;
    }
    if (!live.present || !renderer || renderer.contextLost) throw Error("No live turn.");
    const at = performance.now(), bitmap = live.present(message.turn), ms = performance.now() - at;
    let gpuMs: number | undefined;
    if (message.measure) { renderer.finish(); gpuMs = performance.now() - at; }
    scope.postMessage({ id: message.id, ok: true, bitmap, ms, ...(gpuMs !== undefined ? { gpuMs } : {}) }, [bitmap]);
  } catch (error) {
    scope.postMessage({ id: message.id, ok: false, error: (error as Error)?.message ?? String(error), lost: !!renderer?.contextLost,
      ...((error as { superseded?: boolean })?.superseded ? { superseded: true } : {}) });
  }
}
scope.onmessage = event => {
  const message = event.data;
  if (message.type === "live" || message.type === "live-frame" || message.type === "live-stop") { void liveMessage(message); return; }
  // One job at a time, in arrival order.
  queue = queue.then(async () => {
    try {
      if (message.type === "subject") {
        subject = { glb: await fetchFile(message.url), head: message.head, eyes: message.eyes };
        ready().setSubject(subject);
        scope.postMessage({ id: message.id, ok: true });
        return;
      }
      const source = parsePreviewSource(message.source);
      const result = await ready().render(source, { urlOf: file => `${message.fileBase}${file}?background=1`, frames: message.frames ?? 1 });
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      scope.postMessage({ id: message.id, ok: true, webp: result.webp, timings: result.timings, ...(heap ? { heap } : {}) });
    } catch (error) {
      scope.postMessage({ id: message.id, ok: false, error: (error as Error)?.message ?? String(error),
        lost: !!(error as { lost?: boolean })?.lost || !!renderer?.contextLost });
    }
  });
};
