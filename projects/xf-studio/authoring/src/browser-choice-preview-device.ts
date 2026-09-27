/**
 * Browser device for choice previews (choice-preview-service.ts `ChoicePreviewPort`): the host's preview endpoint
 * (choice-preview-server.ts) and the preview worker (choice-preview-worker.ts), which draws off the main thread with its own WebGL 2
 * context. Images the worker draws are shown at once from memory and stored on the host under their key for later sessions.
 */
import { CHOICE_PREVIEW_SCHEMA, type ChoicePreviewSource, parsePreviewSource } from "./choice-preview";
import type { ChoicePreviewPort, PreviewSourceReply } from "./choice-preview-service";
import type { PreviewWorkerReply, PreviewWorkerRequest } from "./choice-preview-worker";
import { CHARACTER_DETAIL_ASSETS, coreAssetName, coreDetailUrl, parseCoreDetail } from "./render-detail";

export const CHOICE_PREVIEW_ENDPOINT = "/api/preview-character/creator/previews";
const SOURCES_SCHEMA = "xfs/choice-preview-sources-1";
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function createBrowserChoicePreviewDevice(options: { fetch?: Fetch; workerUrl?: string; makeWorker?: () => Worker } = {}): ChoicePreviewPort {
  const fetcher: Fetch = options.fetch ?? ((url, init) => fetch(url, init));
  let worker: Worker | null = null, serial = 0;
  const pending = new Map<number, { resolve(reply: PreviewWorkerReply): void }>();
  type Message = PreviewWorkerRequest extends infer R ? R extends PreviewWorkerRequest ? Omit<R, "id"> : never : never;
  const post = (message: Message): Promise<PreviewWorkerReply> => {
    worker ??= (() => {
      const made = options.makeWorker?.() ?? new Worker(options.workerUrl ?? "/build/choice-preview-worker.js", { type: "module" });
      made.onmessage = (event: MessageEvent<PreviewWorkerReply>) => { pending.get(event.data.id)?.resolve(event.data); pending.delete(event.data.id); };
      // A worker that can't start (no module workers, no OffscreenCanvas WebGL 2) fails every job; tiles keep their glyph.
      made.onerror = () => { for (const [id, job] of pending) job.resolve({ id, ok: false, error: "The preview worker stopped." }); pending.clear(); };
      return made;
    })();
    const id = ++serial;
    return new Promise(resolve => { pending.set(id, { resolve }); worker!.postMessage({ ...message, id } as PreviewWorkerRequest); });
  };
  return {
    async sources(request, option, kind, positions, derive, signal) {
      const response = await fetcher(CHOICE_PREVIEW_ENDPOINT, { method: "POST", signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, option, kind, positions: [...positions], ...(derive !== null ? { derive } : {}) }) });
      const value = await response.json() as { schema?: unknown; items?: unknown };
      if (!response.ok || value?.schema !== SOURCES_SCHEMA || !Array.isArray(value.items)) throw Error("Choice previews aren't available.");
      return (value.items as PreviewSourceReply[]).flatMap((item): PreviewSourceReply[] => {
        if (!Number.isInteger(item?.position) || !["ready", "none", "unprepared"].includes(item.state)) return [];
        if (item.state !== "ready") return [{ position: item.position, state: item.state }];
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
      // Kept on the host for later sessions; shown from memory now either way.
      void fetcher(`${CHOICE_PREVIEW_ENDPOINT}/${key}`, { method: "POST", headers: { "Content-Type": "image/webp" }, body: reply.webp }).catch(() => {});
      return { url: URL.createObjectURL(reply.webp), timings: { ...(reply.timings as object ?? {}), bytesOut: reply.webp.size, ...(reply.heap ? { heap: reply.heap } : {}) } };
    },
  };
}
