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
import { DOCUMENT_ID, DOCUMENT_KIND, parseFence, WORKSPACE_FENCE_HEADER, WORKSPACE_LEASE_KIND, type DocumentWrite, type StoredDocument,
  type WorkspaceFence } from "../api/document-store";
import { COMMAND_LIMITS, type CommandRevisions, type CurrentDocument, type DocumentRef, documentKey, isHostKind, RECEIPT_KIND, RECEIPT_TTL_MS,
  type TransactAnswer, type TransactRequest, type TransactWrite } from "../api/document-commands";
import type { LibraryDatabase } from "./library-database";

export type DocumentStoreOptions = {
  /** Wall time for `updatedAt` (the host clock's `now`). */
  readonly now?: () => number;
  /** Crash harnesses only: runs inside a command's transaction after its writes, before it commits (a kill there rolls it back). */
  readonly beforeCommit?: (request: TransactRequest) => void;
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

  /** The newest lease generation issued for `workspace` (0 before the first). */
  leaseGeneration(workspace: string): number {
    return this.get<{ generation?: number }>(WORKSPACE_LEASE_KIND, workspace)?.value.generation ?? 0;
  }
  /**
   * Issues the next lease generation for `workspace` (profiles design §2.3), in one transaction: from then on a write fenced with an
   * older one is refused. Kept in the library, so a host restart never issues a generation twice.
   */
  nextLease(workspace: string): number {
    if (!DOCUMENT_ID.test(workspace)) throw new DocumentStoreError("That isn't a workspace.");
    return this.db.write(() => {
      const current = this.get<{ generation?: number }>(WORKSPACE_LEASE_KIND, workspace);
      const generation = (current?.value.generation ?? 0) + 1;
      const written = this.put(WORKSPACE_LEASE_KIND, workspace, { schema: "xfs/workspace-lease-1", generation }, current?.revision ?? 0);
      if (!written.ok) throw new DocumentStoreError("The workspace lease changed while it was issued.");
      return generation;
    });
  }

  /**
   * Writes `value` over revision `revision` (0 when the document doesn't exist yet), in one immediate transaction. With a `fence`,
   * the write is refused as `superseded` when its workspace has issued a newer lease generation since, checked in the same transaction.
   */
  put<T = unknown>(kind: string, id: string, value: T, revision: number, fence?: WorkspaceFence | null): DocumentWrite<T> {
    if (!DOCUMENT_KIND.test(kind)) throw new DocumentStoreError("That isn't a document kind.");
    if (!DOCUMENT_ID.test(id)) throw new DocumentStoreError("That isn't a document ID.");
    if (!Number.isSafeInteger(revision) || revision < 0) throw new DocumentStoreError("That isn't a document revision.");
    const text = JSON.stringify(value);
    if (text === undefined) throw new DocumentStoreError("A document must be a JSON value.");
    const now = (this.options.now ?? Date.now)();
    // A stale write changes no row, so the file's durability isn't told of it.
    return this.db.write((db): DocumentWrite<T> => {
      if (fence && fence.generation < this.leaseGeneration(fence.workspace)) return { ok: false, reason: "superseded" };
      const current = this.get<T>(kind, id);
      if ((current?.revision ?? 0) !== revision) return { ok: false, reason: "stale", current };
      if (current) db.query("UPDATE documents SET revision = ?, value = ?, updated_at = ? WHERE kind = ? AND id = ?").run(revision + 1, text, now, kind, id);
      else db.query("INSERT INTO documents VALUES (?, ?, 1, ?, ?, ?)").run(kind, id, text, now, now);
      return { ok: true, document: { kind, id, revision: revision + 1, value: JSON.parse(text) as T, updatedAt: now } };
    });
  }

  /**
   * One owner command (profiles design §2.1), in one immediate transaction: with a `fence`, refused as `superseded` when its workspace
   * has issued a newer lease generation; the receipts named in `forget` are deleted; a command whose receipt exists is answered from it
   * and nothing is applied again. Otherwise every write's base must be the document's revision: then every write is stored as the next
   * revision with the command's receipt, or nothing is, and the answer is `stale` with the documents as they are. A replay whose bases no
   * longer match, but whose every target already holds exactly the value written, is acknowledged at the current revisions (the
   * equal-value rule, A5).
   */
  transact(request: TransactRequest, fence?: WorkspaceFence | null): TransactAnswer {
    const checked = checkTransact(request);
    const texts = checked.writes.map(write => JSON.stringify(write.value));
    const now = (this.options.now ?? Date.now)();
    return this.db.write((db): TransactAnswer => {
      if (fence && fence.generation < this.leaseGeneration(fence.workspace)) return { ok: false, reason: "superseded" };
      const remove = db.query("DELETE FROM documents WHERE kind = ? AND id = ?");
      for (const id of checked.forget) remove.run(RECEIPT_KIND, id);
      const receipt = this.row(RECEIPT_KIND, checked.id);
      if (receipt) return { ok: true, revisions: (JSON.parse(receipt.value) as { revisions: CommandRevisions }).revisions, replayed: "receipt" };
      const rows = checked.writes.map(write => this.row(write.kind, write.id));
      if (checked.writes.some((write, i) => (rows[i]?.revision ?? 0) !== write.base)) {
        if (rows.every((row, i) => row && row.value === texts[i]))
          return { ok: true, revisions: Object.fromEntries(checked.writes.map((write, i) => [documentKey(write), rows[i]!.revision])), replayed: "equal" };
        return { ok: false, reason: "stale", current: Object.fromEntries(checked.writes.map((write, i) =>
          [documentKey(write), rows[i] ? { revision: rows[i]!.revision, value: JSON.parse(rows[i]!.value) } : null])) };
      }
      const revisions: Record<string, number> = {};
      const update = db.query("UPDATE documents SET revision = ?, value = ?, updated_at = ? WHERE kind = ? AND id = ?");
      const insert = db.query("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?)");
      checked.writes.forEach((write, i) => {
        const revision = write.base + 1;
        if (rows[i]) update.run(revision, texts[i]!, now, write.kind, write.id);
        else insert.run(write.kind, write.id, revision, texts[i]!, now, now);
        revisions[documentKey(write)] = revision;
      });
      insert.run(RECEIPT_KIND, checked.id, 1, JSON.stringify({ command: checked.command, revisions }), now, now);
      this.options.beforeCommit?.(request);
      return { ok: true, revisions };
    });
  }

  /** The current revision of each document (0: none), keyed `<kind>/<id>`, in one read: the revision check (§2.2). */
  revisions(refs: readonly DocumentRef[]): Record<string, number> {
    const checked = checkRefs(refs);
    return this.db.read(() => Object.fromEntries(checked.map(ref => [documentKey(ref), this.revisionOf(ref.kind, ref.id)])));
  }
  /** Each document as it is now (null: none), keyed `<kind>/<id>`, in one read. */
  read(refs: readonly DocumentRef[]): Record<string, CurrentDocument> {
    const checked = checkRefs(refs);
    return this.db.read(() => Object.fromEntries(checked.map(ref => {
      const row = this.row(ref.kind, ref.id);
      return [documentKey(ref), row ? { revision: row.revision, value: JSON.parse(row.value) } : null];
    })));
  }
  /** Deletes receipts older than `olderThan` ms, in one transaction (host start, §1.4); answers how many. */
  purgeReceipts(olderThan = RECEIPT_TTL_MS): number {
    const cutoff = (this.options.now ?? Date.now)() - olderThan;
    return this.db.write(db => db.query("DELETE FROM documents WHERE kind = ? AND updated_at < ?").run(RECEIPT_KIND, cutoff).changes);
  }

  private row(kind: string, id: string): { revision: number; value: string } | null {
    return this.db.read(db => db.query("SELECT revision, value FROM documents WHERE kind = ? AND id = ?").get(kind, id) as { revision: number; value: string } | null);
  }
  private revisionOf(kind: string, id: string): number {
    return (this.db.read(db => db.query("SELECT revision FROM documents WHERE kind = ? AND id = ?").get(kind, id) as { revision: number } | null))?.revision ?? 0;
  }
}

const COMMAND_NAME = /^[a-z][A-Za-z0-9.-]{0,63}$/;
/** References a page may read: valid kinds and IDs, at most 1,000. */
function checkRefs(refs: readonly DocumentRef[]): DocumentRef[] {
  if (!Array.isArray(refs) || refs.length > 1000) throw new DocumentStoreError("That isn't a list of documents.");
  return refs.map(ref => {
    if (!ref || typeof ref !== "object" || typeof ref.kind !== "string" || !DOCUMENT_KIND.test(ref.kind)) throw new DocumentStoreError("That isn't a document kind.");
    if (typeof ref.id !== "string" || !DOCUMENT_ID.test(ref.id)) throw new DocumentStoreError("That isn't a document ID.");
    return { kind: ref.kind, id: ref.id };
  });
}
/** A command the store takes: an ID, a name, 1–64 writes of distinct page-writable documents, and receipts to forget. */
function checkTransact(request: TransactRequest): { id: string; command: string; writes: TransactWrite[]; forget: string[] } {
  const r = request as Partial<TransactRequest> | null;
  if (!r || typeof r !== "object") throw new DocumentStoreError("That isn't a command.");
  if (typeof r.id !== "string" || !DOCUMENT_ID.test(r.id)) throw new DocumentStoreError("That isn't a command ID.");
  if (typeof r.command !== "string" || !COMMAND_NAME.test(r.command)) throw new DocumentStoreError("That isn't a command.");
  if (!Array.isArray(r.writes) || !r.writes.length || r.writes.length > COMMAND_LIMITS.writes) throw new DocumentStoreError("A command writes 1 to 64 documents.");
  const forget = r.forget ?? [];
  if (!Array.isArray(forget) || forget.length > COMMAND_LIMITS.forget || forget.some(id => typeof id !== "string" || !DOCUMENT_ID.test(id)))
    throw new DocumentStoreError("That isn't a list of receipts.");
  const seen = new Set<string>();
  const writes = r.writes.map(write => {
    const [ref] = checkRefs([write]);
    if (isHostKind(ref!.kind)) throw new DocumentStoreError("That document is the library's own.");
    if (seen.has(documentKey(ref!))) throw new DocumentStoreError("A command writes each document once.");
    seen.add(documentKey(ref!));
    if (!Number.isSafeInteger(write.base) || write.base < 0) throw new DocumentStoreError("That isn't a document revision.");
    if (JSON.stringify(write.value) === undefined) throw new DocumentStoreError("A document must be a JSON value.");
    return { ...ref!, base: write.base, value: write.value };
  });
  return { id: r.id, command: r.command, writes, forget: [...forget] };
}

/** Most bytes of one document write's request body. */
export const DOCUMENT_BODY_BYTES = 16_000_000;
/** The hosts a local Studio page is served from. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The page's transport, under `prefix` (`/api/documents`; a verification workspace's own library under
 * `/api/verification/documents`):
 *
 * - `GET <prefix>?kind=<kind>` answers `{ documents }`;
 * - `POST <prefix>/transact` with a `TransactRequest` answers the `TransactAnswer` (a write from a page that no longer holds its workspace
 *   is 409 `{ code: "superseded" }`);
 * - `POST <prefix>/revisions` and `POST <prefix>/read` with `{ refs }` answer `{ revisions }` and `{ documents }`.
 *
 * Local, same-origin requests only. Commands are the only writes: there is no single-document write route.
 */
export function createDocumentsHandler(store: DocumentStore, prefix: string): (request: Request) => Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  return async request => {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    const route = url.pathname === prefix ? "" : url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length + 1) : null;
    if (route === null || !["", "transact", "revisions", "read"].includes(route)) return json({ error: "Not found." }, 404);
    if (!LOCAL_HOSTS.has(url.hostname) || (origin && origin !== url.origin)) return json({ error: "Local studio requests only." }, 403);
    try {
      if (route === "") return request.method === "GET" ? json({ documents: store.list(url.searchParams.get("kind") ?? "") }) : json({ error: "Method not allowed." }, 405);
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (origin !== url.origin || request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return json({ error: "Use the local studio." }, 403);
      const declared = Number(request.headers.get("Content-Length") ?? NaN);
      if (Number.isFinite(declared) && declared > DOCUMENT_BODY_BYTES) return json({ error: "That is too large to save." }, 413);
      const text = await request.text();
      if (text.length > DOCUMENT_BODY_BYTES) return json({ error: "That is too large to save." }, 413);
      let body: unknown;
      try { body = JSON.parse(text); } catch { return json({ error: "Invalid JSON." }, 400); }
      if (!body || typeof body !== "object") return json({ error: "Invalid JSON." }, 400);
      if (route === "revisions") return json({ revisions: store.revisions((body as { refs: DocumentRef[] }).refs) });
      if (route === "read") return json({ documents: store.read((body as { refs: DocumentRef[] }).refs) });
      const fence = parseFence(request.headers.get(WORKSPACE_FENCE_HEADER));
      if (fence === "invalid") return json({ error: "That isn't a workspace lease." }, 400);
      const answer = store.transact(body as TransactRequest, fence);
      return !answer.ok && answer.reason === "superseded"
        ? json({ code: "superseded", error: "This workspace is now open elsewhere, so this change wasn't saved here." }, 409)
        : json(answer);
    } catch (error) {
      if (error instanceof DocumentStoreError) return json({ error: error.message }, 400);
      return json({ error: "Saved documents are unavailable right now." }, 500);
    }
  };
}

/**
 * The localhost page's lease generations (profiles design §2.3), at `path` (`/api/workspace-lease`, or under `/api/verification`):
 * `POST { workspace }` answers `{ generation }`, the next one for that workspace. The page asks once it holds the browser's Web Lock
 * for the workspace; the desktop host issues its own (`desktop/workspace-lease-host.ts`). Local, same-origin requests only.
 */
export function createWorkspaceLeaseHandler(store: DocumentStore, path: string): (request: Request) => Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  return async request => {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    if (url.pathname !== path) return json({ error: "Not found." }, 404);
    if (!LOCAL_HOSTS.has(url.hostname) || origin !== url.origin) return json({ error: "Local studio requests only." }, 403);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    let body: { workspace?: unknown };
    try { body = await request.json() as typeof body; } catch { return json({ error: "Invalid JSON." }, 400); }
    if (typeof body?.workspace !== "string" || !DOCUMENT_ID.test(body.workspace)) return json({ error: "That isn't a workspace." }, 400);
    try { return json({ generation: store.nextLease(body.workspace) }); }
    catch { return json({ error: "The workspace lease is unavailable right now." }, 500); }
  };
}
