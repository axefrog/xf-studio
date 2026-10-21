import { formatFence, WORKSPACE_FENCE_HEADER, type DocumentStorePort, type DocumentWrite, type StoredDocument,
  type WorkspaceFence } from "../../platform/api/document-store";

/**
 * The page's document store: the host's `/api/documents` transport (`platform/persistence/document-store.ts`). `prefix` is
 * `/api/documents`, or `/api/verification/documents` for a verification workspace's own library; `send` is the page's fetch.
 */
export function browserDocuments(prefix: string, send: (url: string, init?: RequestInit) => Promise<Response>,
  /** The workspace lease each write carries (profiles design §2.3), so the host can refuse it from a window that released it. */
  fence?: () => WorkspaceFence | null): DocumentStorePort {
  const failure = async (response: Response) => {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    return new Error(body?.error ?? "Saved documents are unavailable right now.");
  };
  return {
    async list<T>(kind: string, signal?: AbortSignal) {
      const response = await send(`${prefix}?kind=${encodeURIComponent(kind)}`, { headers: { Accept: "application/json" }, ...(signal ? { signal } : {}) });
      if (!response.ok) throw await failure(response);
      return (await response.json() as { documents: StoredDocument<T>[] }).documents;
    },
    async put<T>(kind: string, id: string, value: T, revision: number): Promise<DocumentWrite<T>> {
      const lease = fence?.();
      const response = await send(`${prefix}?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`, { method: "PUT",
        headers: { "Content-Type": "application/json", ...(lease ? { [WORKSPACE_FENCE_HEADER]: formatFence(lease) } : {}) },
        body: JSON.stringify({ revision, value }) });
      if (response.status === 409) {
        const body = await response.json() as { code?: string; current: StoredDocument<T> | null };
        return body.code === "superseded" ? { ok: false, reason: "superseded" } : { ok: false, reason: "stale", current: body.current };
      }
      if (!response.ok) throw await failure(response);
      return { ok: true, document: (await response.json() as { document: StoredDocument<T> }).document };
    },
  };
}
