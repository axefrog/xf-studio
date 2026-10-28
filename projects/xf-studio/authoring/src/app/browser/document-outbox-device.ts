/**
 * The page's outbox, started (profiles design §2.2, §2.3): the host's document routes behind the workspace lease, the outbox over the
 * page's storage for it, and the revision checks. Both hosts start it the same way; only the storage differs (`outbox-storage.ts`).
 *
 * - **Opened only by the window holding its workspace:** a read-only window records and sends nothing, and leaves the stored entries to
 *   the holder.
 * - **Release** (§2.3 step 3): the outbox drains first (every queued entry acknowledged; stored conflicts stay for the next holder), then
 *   any background copy of its keys is stored (the desktop host's); once released, it stops for good.
 * - **Revision checks** (A7): every 10 s while the window is visible, and whenever it gains focus; the outbox checks again by itself once
 *   the host answers after failing (a host restart).
 */
import type { DocumentStorePort, WorkspaceFence } from "../../platform/api/document-store";
import { DocumentOutbox, type OutboxStorage } from "../../platform/core/document-outbox";
import type { WorkspaceLease } from "../workspace/workspace-lease";
import { leasedDocuments } from "../workspace/leased-documents";
import { browserDocuments } from "./browser-documents-device";

export const REVISION_CHECK_MS = 10_000;

export type StartedOutbox = { readonly outbox: DocumentOutbox; readonly documents: DocumentStorePort;
  /** The workspace's identity, and the lease every library write from this window carries (null: none now). */
  readonly workspace: string; fence(): WorkspaceFence | null;
  /** Secure synchronous recovery before the workspace's release decision; failure preserves the live recovery sources. */
  prepareRelease(): boolean;
  /** Persist first, then stop; false retains the lease for recovery/retry. */
  stop(): Promise<boolean> };

export function startDocumentOutbox(options: {
  /** `/api/documents`, or `/api/verification/documents`. */
  prefix: string;
  send: typeof fetch;
  storage: OutboxStorage & { settle?(): Promise<boolean> };
  /** The workspace's identity: its lease fences every command with it. */
  workspace: string;
  lease?: WorkspaceLease;
  /** The immutable, content-addressed document kinds (`compose/document-kinds.ts`). */
  immutable?: (kind: string) => boolean;
  report?: (error: unknown) => void;
  /** Where focus and visibility are heard (the page's window and document). */
  page?: { addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void; visible(): boolean };
}): StartedOutbox {
  const lease = options.lease;
  let accepting = true, stopping: Promise<boolean> | undefined;
  const fence = (): WorkspaceFence | null => { const generation = lease?.generation() ?? null; return generation === null ? null : { workspace: options.workspace, generation }; };
  // `fetch` is called on its own, never as a method of `options` (the browser refuses that: "Illegal invocation").
  const send = options.send;
  const transport = browserDocuments(options.prefix, (url, init) => send(url, init), fence);
  const documents = leasedDocuments(transport, { draining: () => accepting && (lease?.draining() ?? true) });
  const outbox = new DocumentOutbox(documents, options.storage, {
    writable: () => lease?.writable() ?? true, sendable: () => lease?.draining() ?? true, report: options.report,
    ...(options.immutable ? { immutable: options.immutable } : {}) });
  if (!lease || lease.writable()) outbox.open();
  const check = () => { void outbox.check().catch(error => { if (!outbox.status().stopped) options.report?.(error); }); };
  const page = options.page;
  const timer = setInterval(() => { if (page?.visible() ?? true) check(); }, REVISION_CHECK_MS);
  page?.addEventListener("focus", check);
  const prepareRelease = () => { if (outbox.status().stopped) return true; outbox.store(); return outbox.protect(); };
  const stop = (): Promise<boolean> => {
    if (stopping) return stopping;
    // No later command may bypass the outbox through this retained transport.
    accepting = false;
    clearInterval(timer); page?.removeEventListener("focus", check);
    if (!outbox.stop()) return Promise.resolve(false);
    stopping = (async () => await options.storage.settle?.() ?? true)()
      .catch(error => { options.report?.(error); return false; }).finally(() => { stopping = undefined; });
    return stopping;
  };
  if (lease) {
    lease.onRelease(() => outbox.settle());
    if (options.storage.settle) lease.onRelease(() => options.storage.settle!());
    lease.onReleased(() => { void stop(); });
  }
  return { outbox, documents, workspace: options.workspace, fence, prepareRelease, stop };
}

/** Root abort is published only after the workspace owner permits release. Consumers retire synchronously before this final handoff. */
export function bindWorkspaceHostLifetime(documents: StartedOutbox, lease: WorkspaceLease | undefined, signal: AbortSignal,
  report: (error: unknown) => void) {
  const stop = () => { queueMicrotask(() => {
    void documents.stop().then(ok => {
      if (!ok) { report(Error("Pending changes could not be protected. The workspace lease was kept for recovery.")); return; }
      return lease?.stop();
    }).catch(report);
  }); };
  if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
}

/** The browser page's focus and visibility, for `startDocumentOutbox`. */
export const browserPage = () => ({
  addEventListener: (type: string, listener: () => void) => addEventListener(type, listener),
  removeEventListener: (type: string, listener: () => void) => removeEventListener(type, listener),
  visible: () => document.visibilityState === "visible",
});
