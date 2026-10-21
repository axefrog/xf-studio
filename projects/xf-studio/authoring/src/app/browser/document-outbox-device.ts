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
import type { DocumentStorePort } from "../../platform/api/document-store";
import { DocumentOutbox, type OutboxStorage } from "../../platform/core/document-outbox";
import type { WorkspaceLease } from "../workspace/workspace-lease";
import { leasedDocuments } from "../workspace/leased-documents";
import { browserDocuments } from "./browser-documents-device";

export const REVISION_CHECK_MS = 10_000;

export type StartedOutbox = { readonly outbox: DocumentOutbox; readonly documents: DocumentStorePort; stop(): void };

export function startDocumentOutbox(options: {
  /** `/api/documents`, or `/api/verification/documents`. */
  prefix: string;
  send: typeof fetch;
  storage: OutboxStorage & { settle?(): Promise<boolean> };
  /** The workspace's identity: its lease fences every command with it. */
  workspace: string;
  lease?: WorkspaceLease;
  report?: (error: unknown) => void;
  /** Where focus and visibility are heard (the page's window and document). */
  page?: { addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void; visible(): boolean };
}): StartedOutbox {
  const lease = options.lease;
  const transport = browserDocuments(options.prefix, (url, init) => options.send(url, init),
    () => { const generation = lease?.generation() ?? null; return generation === null ? null : { workspace: options.workspace, generation }; });
  const documents = lease ? leasedDocuments(transport, lease) : transport;
  const outbox = new DocumentOutbox(documents, options.storage, {
    writable: () => lease?.writable() ?? true, sendable: () => lease?.draining() ?? true, report: options.report });
  if (!lease || lease.writable()) outbox.open();
  const check = () => { void outbox.check().catch(error => options.report?.(error)); };
  const page = options.page;
  const timer = setInterval(() => { if (page?.visible() ?? true) check(); }, REVISION_CHECK_MS);
  page?.addEventListener("focus", check);
  const stop = () => { clearInterval(timer); page?.removeEventListener("focus", check); outbox.stop(); };
  if (lease) {
    lease.onRelease(() => outbox.settle());
    if (options.storage.settle) lease.onRelease(() => options.storage.settle!());
    lease.onReleased(stop);
  }
  return { outbox, documents, stop };
}

/** The browser page's focus and visibility, for `startDocumentOutbox`. */
export const browserPage = () => ({
  addEventListener: (type: string, listener: () => void) => addEventListener(type, listener),
  removeEventListener: (type: string, listener: () => void) => removeEventListener(type, listener),
  visible: () => document.visibilityState === "visible",
});
