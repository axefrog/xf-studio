import type { DocumentStorePort, DocumentWrite, StoredDocument } from "../../platform/api/document-store";

/**
 * The page's document store: the host's `/api/documents` transport (`platform/persistence/document-store.ts`). `prefix` is
 * `/api/documents`, or `/api/verification/documents` for a verification workspace's own library; `send` is the page's fetch.
 */
export function browserDocuments(prefix: string, send: (url: string, init?: RequestInit) => Promise<Response>): DocumentStorePort {
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
      const response = await send(`${prefix}?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`, { method: "PUT",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, value }) });
      if (response.status === 409) return { ok: false, reason: "stale", current: (await response.json() as { current: StoredDocument<T> | null }).current };
      if (!response.ok) throw await failure(response);
      return { ok: true, document: (await response.json() as { document: StoredDocument<T> }).document };
    },
  };
}
