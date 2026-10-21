/**
 * The document store's contract: typed, versioned documents kept in the library file. A document is a JSON value
 * addressed by its kind (what it is, for example `hair-groom`) and its ID, with a revision that every write increases.
 * A write names the revision it read, so a page holding an older copy can't overwrite a newer change unnoticed. Types only: the host
 * implements it (`platform/persistence/document-store.ts`) and the page reaches it over `/api/documents`.
 */
import type { CurrentDocument, DocumentRef, TransactAnswer, TransactRequest } from "./document-commands";

/** A kind: lowercase letters, digits and `-`/`.`, starting with a letter. */
export const DOCUMENT_KIND = /^[a-z][a-z0-9.-]{0,63}$/;
/** An ID: 1–200 characters, none of them control characters. */
export const DOCUMENT_ID = /^[^\u0000-\u001f\u007f]{1,200}$/;

export type StoredDocument<T = unknown> = {
  readonly kind: string;
  readonly id: string;
  /** 1 for the first write, one more for each write after it. */
  readonly revision: number;
  readonly value: T;
  /** Wall time of the last write, in milliseconds since the Unix epoch. */
  readonly updatedAt: number;
};

/**
 * A write's answer: the stored document; `stale` with the current one when the revision it named is no longer current; or
 * `superseded` when the page that sent it no longer holds its workspace (a newer lease generation, profiles design §2.3), so
 * nothing was written.
 */
export type DocumentWrite<T = unknown> =
  | { readonly ok: true; readonly document: StoredDocument<T> }
  | { readonly ok: false; readonly reason: "stale"; readonly current: StoredDocument<T> | null }
  | { readonly ok: false; readonly reason: "superseded" };

/**
 * The workspace lease a document command carries (profiles design §2.3): the workspace it was written from and the lease
 * generation that page held. The host refuses a generation older than the workspace's newest.
 */
export type WorkspaceFence = { readonly workspace: string; readonly generation: number };
/** The request header that carries a `WorkspaceFence`: `<generation> <workspace, URI-encoded>`. */
export const WORKSPACE_FENCE_HEADER = "X-XFS-Workspace-Lease";
export const formatFence = (fence: WorkspaceFence) => `${fence.generation} ${encodeURIComponent(fence.workspace)}`;
/** The fence a request carries: null without one, "invalid" for a malformed one. */
export function parseFence(header: string | null): WorkspaceFence | null | "invalid" {
  if (header === null) return null;
  const match = /^(\d{1,15}) (\S{1,600})$/.exec(header);
  if (!match) return "invalid";
  try {
    const workspace = decodeURIComponent(match[2]);
    return DOCUMENT_ID.test(workspace) ? { workspace, generation: Number(match[1]) } : "invalid";
  } catch { return "invalid"; }
}
/** The `documents` kind the host keeps each workspace's newest lease generation under (ID: the workspace). */
export const WORKSPACE_LEASE_KIND = "xfs-workspace-lease";

/**
 * The library's documents as the page reaches them. Reads go straight to the library; every write is an owner command (`transact`),
 * sent only by the outbox (`platform/core/document-outbox.ts`), the one way a document's local state reaches the library.
 */
export interface DocumentStorePort {
  /** Every document of a kind, in the order they were first written; `signal` abandons the read. */
  list<T = unknown>(kind: string, signal?: AbortSignal): Promise<readonly StoredDocument<T>[]>;
  /** One command, in one host transaction, idempotent by its ID (profiles design §2.1). Throws when the host can't be reached. */
  transact(request: TransactRequest): Promise<TransactAnswer>;
  /** The current revision of each document (0: it doesn't exist), keyed `<kind>/<id>`, in one read (the revision check, §2.2). */
  revisions(refs: readonly DocumentRef[], signal?: AbortSignal): Promise<Readonly<Record<string, number>>>;
  /** Each document as it is now (null: it doesn't exist), keyed `<kind>/<id>`, in one read. */
  read(refs: readonly DocumentRef[], signal?: AbortSignal): Promise<Readonly<Record<string, CurrentDocument>>>;
}

/**
 * One stored document as the page holds it (`platform/core/saved-document.ts`, over the outbox): its value changes at once and reaches
 * the library through the outbox.
 */
export interface SavedDocument<T> {
  readonly kind: string;
  readonly id: string;
  readonly value: T;
  /**
   * Sets the value now and records it in the outbox. Resolves once the library holds it (or a newer value); rejects when it can't
   * (it went stale and is a conflict to resolve, or this page no longer holds its workspace).
   */
  save(value: T): Promise<void>;
}
