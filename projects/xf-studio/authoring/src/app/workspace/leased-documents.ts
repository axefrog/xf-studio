/**
 * The page's document store behind its workspace lease (profiles design §2.3): reads always pass; a command is sent only while this
 * page holds the workspace or is draining it as it releases, and is otherwise answered `superseded` without reaching the host. The
 * release's drain is the outbox's (`DocumentOutbox.settle`), which waits for commands in flight too; `pending` counts them here.
 */
import type { DocumentStorePort } from "../../platform/api/document-store";

export type LeasedDocuments = DocumentStorePort & {
  /** Commands in flight now (tests and the harness). */
  pending(): number;
};

export function leasedDocuments(inner: DocumentStorePort, lease: { draining(): boolean }): LeasedDocuments {
  let inFlight = 0;
  return {
    list: (kind, signal) => inner.list(kind, signal),
    revisions: (refs, signal) => inner.revisions(refs, signal),
    read: (refs, signal) => inner.read(refs, signal),
    transact(request) {
      if (!lease.draining()) return Promise.resolve({ ok: false, reason: "superseded" });
      inFlight++;
      return inner.transact(request).finally(() => { inFlight--; });
    },
    pending: () => inFlight,
  };
}
