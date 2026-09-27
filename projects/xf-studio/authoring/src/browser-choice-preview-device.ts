/**
 * Browser device for choice previews (choice-preview-service.ts `ChoicePreviewPort`): the host's preview endpoint
 * (choice-preview-server.ts) and the preview worker (choice-preview-worker.ts), which draws off the main thread with its own WebGL 2
 * context. Images the worker draws are stored on the host under their key and shown from the host's URL (PREV-156), so the page holds
 * no copy; only an image the host couldn't keep is shown from an object URL, at most `OBJECT_URLS` of them, the oldest revoked first,
 * and all of them on `release` or `dispose`.
 *
 * **The worker.** A worker that stops (`onerror`) is dropped and every job waiting on it fails; the next job starts a new one, with
 * the subject head loaded again first. A second stop leaves previews off for the session (every job fails at once, tiles keep their
 * glyph) rather than restarting a worker that can't run here (PREV-158).
 */
import { CHOICE_PREVIEW_SCHEMA, type ChoicePreviewSource, parsePreviewSource } from "./choice-preview";
import { type ChoicePreviewPort, PreviewHostError, PreviewSuperseded, type PreviewSourceReply } from "./choice-preview-service";
import type { PreviewWorkerReply, PreviewWorkerRequest } from "./choice-preview-worker";
import { CHARACTER_DETAIL_ASSETS, coreAssetName, coreDetailUrl, parseCoreDetail } from "./render-detail";

export const CHOICE_PREVIEW_ENDPOINT = "/api/preview-character/creator/previews";
const SOURCES_SCHEMA = "xfs/choice-preview-sources-1";
/** The most object URLs kept for images the host couldn't store (each a few kilobytes, a strip a few hundred). */
export const OBJECT_URLS = 48;
/** Worker starts before previews stay off for the session. */
const WORKER_STARTS = 2;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function createBrowserChoicePreviewDevice(options: { fetch?: Fetch; workerUrl?: string; makeWorker?: () => Worker;
  objectUrls?: { create(blob: Blob): string; revoke(url: string): void } } = {}): ChoicePreviewPort {
  const fetcher: Fetch = options.fetch ?? ((url, init) => fetch(url, init));
  const urls = options.objectUrls ?? { create: (blob: Blob) => URL.createObjectURL(blob), revoke: (url: string) => URL.revokeObjectURL(url) };
  let worker: Worker | null = null, serial = 0, starts = 0, off = false;
  /** The subject message last sent, sent again first to a new worker. */
  let subject: Message | null = null;
  const pending = new Map<number, { resolve(reply: PreviewWorkerReply): void }>();
  /** Object URLs in use, oldest first. */
  const objects = new Set<string>();
  type Message = PreviewWorkerRequest extends infer R ? R extends PreviewWorkerRequest ? Omit<R, "id"> : never : never;
  const stopped = (id: number): PreviewWorkerReply => ({ id, ok: false, error: "The preview worker stopped." });
  const start = (): Worker => {
    starts++;
    const made = options.makeWorker?.() ?? new Worker(options.workerUrl ?? "/build/choice-preview-worker.js", { type: "module" });
    made.onmessage = (event: MessageEvent<PreviewWorkerReply>) => { pending.get(event.data.id)?.resolve(event.data); pending.delete(event.data.id); };
    // A worker that stops (or can't start: no module workers, no OffscreenCanvas WebGL 2) fails its jobs and is dropped.
    made.onerror = () => {
      if (worker === made) { worker = null; if (starts >= WORKER_STARTS) off = true; }
      try { made.terminate(); } catch { /* Already gone. */ }
      for (const [id, job] of pending) job.resolve(stopped(id));
      pending.clear();
    };
    // A new worker has no subject head yet: it is loaded first (its reply is nobody's).
    if (subject && starts > 1) made.postMessage({ ...subject, id: ++serial } as PreviewWorkerRequest);
    return made;
  };
  const post = (message: Message): Promise<PreviewWorkerReply> => {
    if (off) { if (message.type === "subject") subject = message; return Promise.resolve(stopped(0)); }
    worker ??= start();
    if (message.type === "subject") subject = message;
    const id = ++serial, to = worker;
    return new Promise(resolve => { pending.set(id, { resolve }); to.postMessage({ ...message, id } as PreviewWorkerRequest); });
  };
  const objectUrl = (blob: Blob) => {
    const url = urls.create(blob);
    objects.add(url);
    for (const oldest of objects) { if (objects.size <= OBJECT_URLS) break; objects.delete(oldest); urls.revoke(oldest); }
    return url;
  };
  return {
    async sources(request, option, kind, positions, derive, signal) {
      const response = await fetcher(CHOICE_PREVIEW_ENDPOINT, { method: "POST", signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, option, kind, positions: [...positions], ...(derive !== null ? { derive } : {}) }) });
      const value = await response.json().catch(() => null) as { schema?: unknown; items?: unknown; code?: unknown } | null;
      if (!response.ok || value?.schema !== SOURCES_SCHEMA || !Array.isArray(value.items))
        throw new PreviewHostError(typeof value?.code === "string" ? value.code : null, response.status);
      return (value.items as PreviewSourceReply[]).flatMap((item): PreviewSourceReply[] => {
        if (!Number.isInteger(item?.position) || !["ready", "none", "unprepared"].includes(item.state)) return [];
        if (item.state !== "ready") return [{ position: item.position, state: item.state, ...(item.state === "unprepared" && item.busy === true ? { busy: true } : {}) }];
        try { return [{ position: item.position, state: "ready", source: parsePreviewSource(item.source) }]; }
        catch { return [{ position: item.position, state: "none" }]; }
      });
    },
    async subject(body) {
      const response = await fetcher(coreDetailUrl(body));
      if (!response.ok) throw Error("The preview head isn't ready.");
      const core = parseCoreDetail(await response.json());
      const url = `/assets/${coreAssetName(body, core.geometry.file)}`;
      const reply = await post({ type: "subject", url, head: core.geometry.nodes.head, eyes: core.geometry.nodes.eyes });
      if (!reply.ok) throw Error(reply.error);
      return `${CHOICE_PREVIEW_SCHEMA}:${body}:${core.identity}`;
    },
    async stored(key) {
      const url = `${CHOICE_PREVIEW_ENDPOINT}/${key}`;
      const response = await fetcher(url, { method: "HEAD" }).catch(() => null);
      return response?.ok ? url : null;
    },
    async render(source: ChoicePreviewSource, key: string, frames = 1) {
      const reply = await post({ type: "render", source, fileBase: CHARACTER_DETAIL_ASSETS, ...(frames > 1 ? { frames } : {}) });
      if (!reply.ok || !reply.webp) throw Error(reply.ok ? "The preview worker drew nothing." : reply.error);
      const timings = { ...(reply.timings as object ?? {}), bytesOut: reply.webp.size, ...(reply.heap ? { heap: reply.heap } : {}) };
      // Kept on the host for later sessions and shown from there (the browser caches it); from memory only when it couldn't be kept.
      const url = `${CHOICE_PREVIEW_ENDPOINT}/${key}`;
      const kept = await fetcher(url, { method: "POST", headers: { "Content-Type": "image/webp" }, body: reply.webp }).then(response => response.ok, () => false);
      return { url: kept ? url : objectUrl(reply.webp), timings };
    },
    release(url) { if (objects.delete(url)) urls.revoke(url); },
    dispose() {
      for (const url of objects) urls.revoke(url);
      objects.clear();
      off = true;
      worker?.terminate();
      worker = null;
      for (const [id, job] of pending) job.resolve(stopped(id));
      pending.clear();
    },
    // The live turn: one source kept in the worker, drawn at any angle as an ImageBitmap (transferred, never copied).
    live: {
      async start(source) {
        const reply = await post({ type: "live", source, fileBase: CHARACTER_DETAIL_ASSETS });
        if (!reply.ok) throw reply.superseded ? new PreviewSuperseded() : Error(reply.error);
      },
      async frame(turn, measure) {
        const reply = await post({ type: "live-frame", turn, ...(measure ? { measure } : {}) });
        if (!reply.ok || !reply.bitmap) throw Error(reply.ok ? "No live frame." : reply.error);
        return { bitmap: reply.bitmap, ms: reply.ms, gpuMs: reply.gpuMs };
      },
      stop() { void post({ type: "live-stop" }); },
    },
  };
}
