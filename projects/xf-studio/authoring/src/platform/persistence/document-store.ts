/**
 * The document store (`platform/api/document-store.ts`): typed, versioned JSON documents in the library file, in a table
 * of their own beside the look, collection and preset tables:
 *
 *     documents(kind, id, revision, value, created_at, updated_at)   primary key (kind, id)
 *
 * **Forward-only, beside the released tables.** The table is the library file's `documents-1` step (library-migrations.ts),
 * created when missing, and `user_version` is left as it is, so every earlier XF Studio opens the same library and never
 * reads this table. The file's owner (`LibraryDatabase`) holds the connection, runs each write as a transaction and tells
 * the file's durability of it, so a flush follows within seconds. A write names the revision it read; a write over any
 * other revision changes nothing and answers `stale` with the current document.
 */
import { DOCUMENT_ID, DOCUMENT_KIND, type DocumentWrite, type StoredDocument } from "../api/document-store";
import type { LibraryDatabase } from "./library-database";

export type DocumentStoreOptions = {
  /** Wall time for `updatedAt` (the host clock's `now`). */
  readonly now?: () => number;
};

type Row = { kind: string; id: string; revision: number; value: string; updated_at: number };
const documentOf = <T>(row: Row): StoredDocument<T> =>
  ({ kind: row.kind, id: row.id, revision: row.revision, value: JSON.parse(row.value) as T, updatedAt: row.updated_at });

/** A request the store refuses (a malformed kind, ID, revision or value); its message is safe to show. */
export class DocumentStoreError extends Error {}

export class DocumentStore {
  constructor(private readonly db: LibraryDatabase, private readonly options: DocumentStoreOptions = {}) {}
  /** The library file. */
  get path(): string { return this.db.path; }

  get<T = unknown>(kind: string, id: string): StoredDocument<T> | null {
    const row = this.db.read(db => db.query("SELECT kind, id, revision, value, updated_at FROM documents WHERE kind = ? AND id = ?").get(kind, id) as Row | null);
    return row ? documentOf<T>(row) : null;
  }

  list<T = unknown>(kind: string): StoredDocument<T>[] {
    if (!DOCUMENT_KIND.test(kind)) throw new DocumentStoreError("That isn't a document kind.");
    return this.db.read(db => db.query("SELECT kind, id, revision, value, updated_at FROM documents WHERE kind = ? ORDER BY rowid").all(kind) as Row[]).map(row => documentOf<T>(row));
  }

  /** Writes `value` over revision `revision` (0 when the document doesn't exist yet), in one immediate transaction. */
  put<T = unknown>(kind: string, id: string, value: T, revision: number): DocumentWrite<T> {
    if (!DOCUMENT_KIND.test(kind)) throw new DocumentStoreError("That isn't a document kind.");
    if (!DOCUMENT_ID.test(id)) throw new DocumentStoreError("That isn't a document ID.");
    if (!Number.isSafeInteger(revision) || revision < 0) throw new DocumentStoreError("That isn't a document revision.");
    const text = JSON.stringify(value);
    if (text === undefined) throw new DocumentStoreError("A document must be a JSON value.");
    const now = (this.options.now ?? Date.now)();
    // A stale write changes no row, so the file's durability isn't told of it.
    return this.db.write((db): DocumentWrite<T> => {
      const current = this.get<T>(kind, id);
      if ((current?.revision ?? 0) !== revision) return { ok: false, reason: "stale", current };
      if (current) db.query("UPDATE documents SET revision = ?, value = ?, updated_at = ? WHERE kind = ? AND id = ?").run(revision + 1, text, now, kind, id);
      else db.query("INSERT INTO documents VALUES (?, ?, 1, ?, ?, ?)").run(kind, id, text, now, now);
      return { ok: true, document: { kind, id, revision: revision + 1, value: JSON.parse(text) as T, updatedAt: now } };
    });
  }
}

/** Most bytes of one document write's request body. */
export const DOCUMENT_BODY_BYTES = 16_000_000;
/** The hosts a local Studio page is served from. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The page's transport, under `prefix` (`/api/documents`; a verification workspace's own library under
 * `/api/verification/documents`): `GET <prefix>?kind=<kind>` answers `{ documents }`, and `PUT <prefix>?kind=<kind>&id=<id>`
 * with `{ revision, value }` answers `{ document }`, or 409 `{ error, current }` when the revision is stale. Local,
 * same-origin requests only.
 */
export function createDocumentsHandler(store: DocumentStore, prefix: string): (request: Request) => Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  return async request => {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    if (url.pathname !== prefix) return json({ error: "Not found." }, 404);
    if (!LOCAL_HOSTS.has(url.hostname) || (origin && origin !== url.origin)) return json({ error: "Local studio requests only." }, 403);
    const kind = url.searchParams.get("kind") ?? "";
    try {
      if (request.method === "GET") return json({ documents: store.list(kind) });
      if (request.method !== "PUT") return json({ error: "Method not allowed." }, 405);
      if (origin !== url.origin || request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return json({ error: "Use the local studio." }, 403);
      const declared = Number(request.headers.get("Content-Length") ?? NaN);
      if (Number.isFinite(declared) && declared > DOCUMENT_BODY_BYTES) return json({ error: "That is too large to save." }, 413);
      const text = await request.text();
      if (text.length > DOCUMENT_BODY_BYTES) return json({ error: "That is too large to save." }, 413);
      let body: { revision?: unknown; value?: unknown };
      try { body = JSON.parse(text) as typeof body; } catch { return json({ error: "Invalid JSON." }, 400); }
      if (!body || typeof body !== "object" || !("value" in body)) return json({ error: "Invalid JSON." }, 400);
      const written = store.put(kind, url.searchParams.get("id") ?? "", body.value, Number(body.revision));
      return written.ok ? json({ document: written.document }) : json({ error: "This changed elsewhere since it was read.", current: written.current }, 409);
    } catch (error) {
      if (error instanceof DocumentStoreError) return json({ error: error.message }, 400);
      return json({ error: "Saved documents are unavailable right now." }, 500);
    }
  };
}
