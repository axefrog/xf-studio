/**
 * The document store's contract: typed, versioned documents kept in the library file. A document is a JSON value
 * addressed by its kind (what it is, for example `hair-groom`) and its ID, with a revision that every write increases.
 * A write names the revision it read, so a page holding an older copy can't overwrite a newer change unnoticed. Types only: the host
 * implements it (`platform/persistence/document-store.ts`) and the page reaches it over `/api/documents`.
 */

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

/** A write's answer: the stored document, or `stale` with the current one when the revision it named is no longer current. */
export type DocumentWrite<T = unknown> =
  | { readonly ok: true; readonly document: StoredDocument<T> }
  | { readonly ok: false; readonly reason: "stale"; readonly current: StoredDocument<T> | null };

export interface DocumentStorePort {
  /** Every document of a kind, in the order they were first written; `signal` abandons the read. */
  list<T = unknown>(kind: string, signal?: AbortSignal): Promise<readonly StoredDocument<T>[]>;
  /** Writes `value` over revision `revision` (0: the document doesn't exist yet). */
  put<T = unknown>(kind: string, id: string, value: T, revision: number): Promise<DocumentWrite<T>>;
}

/**
 * One stored document as the page holds it (`platform/core/saved-document.ts`): its value changes at once and is saved in
 * the background, one write at a time, newest value last.
 */
export interface SavedDocument<T> {
  readonly kind: string;
  readonly id: string;
  readonly value: T;
  /** Sets the value now and saves it. Resolves once it (or a newer value) is stored; rejects when the store couldn't take it. */
  save(value: T): Promise<void>;
}
