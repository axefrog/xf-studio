/**
 * The page's document store behind its workspace lease (profiles design §2.3): reads always pass; a write is sent only while this
 * page holds the workspace or is draining it as it releases, and is otherwise answered `superseded` without reaching the host.
 * `drain` resolves once every write already started (and any its holder chains on, one per document) has settled: the release's
 * "flush pending document saves" step until the outbox exists (phase 1, later chunk).
 */
import type { DocumentStorePort } from "../../platform/api/document-store";

export type LeasedDocuments = DocumentStorePort & {
  /**
   * Resolves once no write is in flight, including writes queued behind ones that settle while it waits: true when every write that
   * settled from its start succeeded, false when one failed or was refused (the release then keeps the lease).
   */
  drain(): Promise<boolean>;
  /** Writes in flight now (tests and the harness). */
  pending(): number;
};

export function leasedDocuments(inner: DocumentStorePort, lease: { draining(): boolean },
  /** One turn of the page's task queue: a holder's next write starts after its previous one settles (`saved-document.ts`). */
  nextTurn: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0))): LeasedDocuments {
  const inFlight = new Set<Promise<unknown>>();
  let failures = 0;
  return {
    list: (kind, signal) => inner.list(kind, signal),
    put(kind, id, value, revision) {
      if (!lease.draining()) return Promise.resolve({ ok: false, reason: "superseded" });
      const write = inner.put(kind, id, value, revision);
      inFlight.add(write);
      write.then(result => { inFlight.delete(write); if (!result.ok && result.reason === "superseded") failures++; },
        () => { inFlight.delete(write); failures++; });
      return write;
    },
    async drain() {
      const before = failures;
      // A save made just before the release starts its write a microtask later; a coalesced save starts once the write before it settles.
      await nextTurn();
      while (inFlight.size) {
        await Promise.allSettled([...inFlight]);
        await nextTurn();
      }
      return failures === before;
    },
    pending: () => inFlight.size,
  };
}
