import { formatFence, WORKSPACE_FENCE_HEADER, type DocumentStorePort, type StoredDocument, type WorkspaceFence } from "../../platform/api/document-store";
import type { CurrentDocument, DocumentRef, TransactAnswer } from "../../platform/api/document-commands";

/**
 * The page's document store: the host's `/api/documents` transport (`platform/persistence/document-store.ts`). `prefix` is
 * `/api/documents`, or `/api/verification/documents` for a verification workspace's own library; `send` is the page's fetch. A
 * request the host never answers (it is down or restarting) throws; the outbox sends the same command again later.
 */
export function browserDocuments(prefix: string, send: (url: string, init?: RequestInit) => Promise<Response>,
  /** The workspace lease each command carries (profiles design §2.3), so the host can refuse it from a window that released it. */
  fence?: () => WorkspaceFence | null): DocumentStorePort {
  const failure = async (response: Response) => {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    return new Error(body?.error ?? "Saved documents are unavailable right now.");
  };
  const post = async <T>(route: string, body: unknown, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> => {
    const response = await send(`${prefix}/${route}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body), ...(signal ? { signal } : {}) });
    if (!response.ok && response.status !== 409) throw await failure(response);
    return { status: response.status, body: await response.json() as T };
  };
  return {
    async list<T>(kind: string, signal?: AbortSignal) {
      const response = await send(`${prefix}?kind=${encodeURIComponent(kind)}`, { headers: { Accept: "application/json" }, ...(signal ? { signal } : {}) });
      if (!response.ok) throw await failure(response);
      return (await response.json() as { documents: StoredDocument<T>[] }).documents;
    },
    async transact(request, signal) {
      const lease = fence?.();
      const answer = await post<TransactAnswer & { code?: string }>("transact", request, signal,
        lease ? { [WORKSPACE_FENCE_HEADER]: formatFence(lease) } : {});
      if (answer.status === 409) {
        if (answer.body.code === "superseded") return { ok: false, reason: "superseded" };
        throw Error("The library answered a command it couldn't take.");
      }
      return answer.body;
    },
    async revisions(refs: readonly DocumentRef[], signal?: AbortSignal) {
      return (await post<{ revisions: Record<string, number> }>("revisions", { refs }, signal)).body.revisions;
    },
    async read(refs: readonly DocumentRef[], signal?: AbortSignal) {
      return (await post<{ documents: Record<string, CurrentDocument> }>("read", { refs }, signal)).body.documents;
    },
  };
}
