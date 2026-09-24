import { CollectionServiceError, type CollectionTransport } from "./collection-service";
import { PackageRequestError, requestPackage } from "./package-action";
import type { CollectionSummary, StoredCollection } from "./collection-store";

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
    save: (collection, revision) => api<StoredCollection>("", { collection, revision }),
    package: async (action, collection) => {
      try { return await requestPackage(action, collection); }
      catch (error) {
        if (error instanceof PackageRequestError) throw new CollectionServiceError(error.code, error.message);
        throw error;
      }
    },
  };
}
