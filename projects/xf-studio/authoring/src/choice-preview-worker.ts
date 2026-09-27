/**
 * The preview worker (choice-previews-design.md §6.1): one WebGL 2 context on an OffscreenCanvas, off the main thread, drawing one
 * preview source at a time (choice-preview-render.ts). Messages: `subject` loads the head every preview is drawn over; `render` draws
 * a source and answers its WebP and timings. A lost context fails the job with `lost`, and the next job makes a new context once.
 */
import { parsePreviewSource } from "./choice-preview";
import { PreviewRenderer, type PreviewSubject } from "./choice-preview-render";

export type PreviewWorkerRequest =
  | { type: "subject"; id: number; url: string; head: string; eyes: string | null }
  | { type: "render"; id: number; source: unknown; fileBase: string };
export type PreviewWorkerReply =
  | { id: number; ok: true; webp?: Blob; timings?: unknown; heap?: number }
  | { id: number; ok: false; error: string; lost?: boolean };

const scope = self as unknown as { postMessage(message: PreviewWorkerReply): void; onmessage: ((event: MessageEvent<PreviewWorkerRequest>) => void) | null };
const fetchFile = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw Error(`A preview file couldn't be read (${response.status}).`);
  return response.arrayBuffer();
};
let renderer: PreviewRenderer | null = null, subject: PreviewSubject | null = null, recreated = false;
function ready(): PreviewRenderer {
  if (renderer && !renderer.contextLost) return renderer;
  if (renderer) { if (recreated) throw Object.assign(Error("The preview context was lost again."), { lost: true }); recreated = true; renderer.dispose(); }
  renderer = new PreviewRenderer(new OffscreenCanvas(1, 1), fetchFile);
  if (subject) renderer.setSubject(subject);
  return renderer;
}
let queue = Promise.resolve();
scope.onmessage = event => {
  const message = event.data;
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
      const result = await ready().render(source, { urlOf: file => `${message.fileBase}${file}?background=1` });
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      scope.postMessage({ id: message.id, ok: true, webp: result.webp, timings: result.timings, ...(heap ? { heap } : {}) });
    } catch (error) {
      scope.postMessage({ id: message.id, ok: false, error: (error as Error)?.message ?? String(error),
        lost: !!(error as { lost?: boolean })?.lost || !!renderer?.contextLost });
    }
  });
};
