import { CollectionServiceError, type CollectionTransport } from "../collection-service";
import { PackageRequestError, requestPackage, requestPackageProgress } from "../../legacy/eye-makeup/export/package-action";
import type { CollectionSummary, StoredCollection } from "../collection-actions";
import type { CollectionVersionsPort, SavedVersion } from "../collection-owner";
import { formatFence, WORKSPACE_FENCE_HEADER, type WorkspaceFence } from "../../platform/api/document-store";

/** Local HTTP is an injected detail, rather than a dependency of collection commands. */
export function collectionTransport(endpoint: string): CollectionTransport {
  async function api<T>(path = "", value?: unknown): Promise<T> {
    const response = await fetch(endpoint + path, { method: value ? "POST" : "GET",
      headers: value ? { "Content-Type": "application/json" } : undefined,
      body: value ? JSON.stringify(value) : undefined });
    if (!(response.headers.get("Content-Type") ?? "").includes("application/json"))
      throw new CollectionServiceError("transport", "Restart the studio server to enable collection storage. Your draft is safe.");
    const data = await response.json();
    if (!response.ok) throw new CollectionServiceError(response.status === 409 ? "conflict" : "storage_failed",
      data.error ?? "Collection request failed.");
    return data;
  }
  return {
    list: () => api<CollectionSummary[]>(),
    get: id => api<StoredCollection>(`/${encodeURIComponent(id)}`),
    package: async (action, collection) => {
      try { return await requestPackage(action, collection); }
      catch (error) {
        if (error instanceof PackageRequestError) throw new CollectionServiceError(error.code, error.message);
        throw error;
      }
    },
    packageProgress: () => requestPackageProgress().catch(() => null),
  };
}

/**
 * Save version's transport (`/api/collection-versions`, or under `/api/verification`): the host saves a named version from its own
 * snapshot of the collection's working copies. `fence` is the workspace lease the page holds, so a released page's save is refused.
 */
export function collectionVersions(endpoint: string, send: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  fence?: () => WorkspaceFence | null): CollectionVersionsPort {
  return {
    async save(collection, signal) {
      const lease = fence?.();
      const response = await send(endpoint, { method: "POST", ...(signal ? { signal } : {}),
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(lease ? { [WORKSPACE_FENCE_HEADER]: formatFence(lease) } : {}) },
        body: JSON.stringify({ collection }) });
      const body = await response.json().catch(() => null) as (SavedVersion & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error ?? "The version couldn't be saved right now. Your working copy is safe.");
      return { revision: body.revision, updatedAt: body.updatedAt, documents: body.documents };
    },
  };
}
