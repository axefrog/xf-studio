/**
 * The document store: typed, versioned documents in the library file, beside the released tables (user_version untouched),
 * reloaded from the same file, reached by the page over `/api/documents`, and held by the page as saved documents.
 */
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentsHandler } from "../src/platform/persistence/document-store";
import { browserDocuments } from "../src/app/browser/browser-documents-device";
import { savedDocument } from "../src/platform/core/saved-document";
import type { DocumentStorePort } from "../src/platform/api/document-store";
import { STUDIO_PARTS } from "../src/compose/studio-registry";
import { COLLECTION_FIXTURES, readFixture } from "./fixtures/capture-plan-golden";
import { alphaList } from "./fixtures/alpha-0.1.0/collection-list";
import { readRecipe } from "../src/legacy/eye-makeup/recipe-schema";
import { ManualClock, settle, storeDocuments } from "./fixtures/platform-doubles";
import { openTestLibrary } from "./fixtures/library-file";

const folders: string[] = [];
function library(): string { const dir = mkdtempSync(join(tmpdir(), "xfs-documents-")); folders.push(dir); return join(dir, "library.sqlite"); }
afterEach(() => { for (const dir of folders.splice(0)) try { rmSync(dir, { recursive: true, force: true }); } catch { /* closing */ } });

test("a write names the revision it read; a stale one changes nothing and answers the current document", () => {
  const clock = new ManualClock(1_000);
  const file = openTestLibrary(":memory:", { clock }), store = file.documents;
  try {
    const first = store.put("sample", "a", { n: 1 }, 0);
    expect(first).toEqual({ ok: true, document: { kind: "sample", id: "a", revision: 1, value: { n: 1 }, updatedAt: 1_000 } });
    clock.advance(1_000);
    expect(store.put("sample", "a", { n: 2 }, 1).ok).toBe(true);
    const stale = store.put("sample", "a", { n: 3 }, 1);
    expect(stale).toEqual({ ok: false, reason: "stale", current: { kind: "sample", id: "a", revision: 2, value: { n: 2 }, updatedAt: 2_000 } });
    expect(store.put("sample", "b", "new", 4)).toEqual({ ok: false, reason: "stale", current: null });
    store.put("sample", "b", "new", 0); store.put("other", "a", [1, 2], 0);
    expect(store.list("sample").map(item => [item.id, item.revision, item.value])).toEqual([["a", 2, { n: 2 }], ["b", 1, "new"]]);
    expect(store.list("other").map(item => item.value)).toEqual([[1, 2]]);
    expect(store.get("sample", "missing")).toBeNull();
    expect(() => store.put("Bad Kind", "a", 1, 0)).toThrow("kind");
    expect(() => store.put("sample", "", 1, 0)).toThrow("ID");
    expect(() => store.put("sample", "a", 1, -1)).toThrow("revision");
    expect(() => store.put("sample", "a", undefined, 2)).toThrow("JSON");
  } finally { file.close(); }
});

test("documents reload from the same file, and each committed write (only) is reported to the file's durability", () => {
  const path = library();
  let writes = 0;
  const file = openTestLibrary(path, { writes: { wrote: () => { writes++; } } }), store = file.documents;
  writes = 0;   // creating the file's tables was a write of its own
  store.put("hair-groom", "g1", { fields: { length: .5 } }, 0);
  store.put("hair-groom", "g1", { fields: { length: .6 } }, 1);
  store.put("hair-groom", "g1", { fields: { length: .7 } }, 1);   // stale
  expect(writes).toBe(2);
  file.close();
  const reopened = openTestLibrary(path);
  try { expect(reopened.documents.list("hair-groom")).toMatchObject([{ id: "g1", revision: 2, value: { fields: { length: .6 } } }]); }
  finally { reopened.close(); }
});

test("a library with the documents table still opens in earlier XF Studio stores, user_version stays 2, and collections list as before", () => {
  const path = library();
  const file = openTestLibrary(path);
  for (const fixture of COLLECTION_FIXTURES) file.collections.save({ collection: STUDIO_PARTS.readCollection(readFixture(fixture)) });
  const before = file.collections.list();
  file.documents.put("experiment-flags", "preferences", { flags: {} }, 0);
  file.close();
  const db = new Database(path, { readonly: true });
  try {
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(2);
    // 0.1.0-alpha.1's own list query and reader, vendored from its tag, read the same collections.
    expect(alphaList(db, value => readRecipe(value)).map(item => [item.id, item.revision, item.count])).toEqual(before.map(item => [item.id, item.revision, item.count]));
  } finally { db.close(); }
  const reopened = openTestLibrary(path);
  expect(reopened.collections.list()).toEqual(before);
  reopened.close();
});

test("the page's transport: the browser device lists and writes through the host endpoint, and a stale write answers the current document", async () => {
  const file = openTestLibrary(), store = file.documents, handler = createDocumentsHandler(store, "/api/documents");
  try {
    const page = browserDocuments("/api/documents", (url, init) => handler(new Request(`http://127.0.0.1:4317${url}`,
      { ...init, headers: { ...(init?.headers as Record<string, string>), Origin: "http://127.0.0.1:4317" } })));
    expect(await page.list("sample")).toEqual([]);
    const written = await page.put("sample", "id with spaces/and slashes", { a: 1 }, 0);
    expect(written.ok && written.document.revision).toBe(1);
    expect((await page.list("sample")).map(item => [item.id, item.value])).toEqual([["id with spaces/and slashes", { a: 1 }]]);
    const stale = await page.put("sample", "id with spaces/and slashes", { a: 2 }, 0);
    expect(stale.ok).toBe(false);
    expect(!stale.ok && stale.reason === "stale" && stale.current?.revision).toBe(1);
    await expect(page.put("Not a kind", "x", 1, 0)).rejects.toThrow("kind");
  } finally { file.close(); }
});

test("the endpoint answers local, same-origin pages only, and refuses what isn't a document write", async () => {
  const file = openTestLibrary(), store = file.documents, handler = createDocumentsHandler(store, "/api/documents");
  const put = (url: string, body: string, headers: Record<string, string> = { Origin: "http://127.0.0.1", "Content-Type": "application/json" }) =>
    handler(new Request(url, { method: "PUT", headers, body }));
  try {
    expect((await handler(new Request("http://example.com/api/documents?kind=a"))).status).toBe(403);
    expect((await handler(new Request("http://127.0.0.1/api/documents?kind=a", { headers: { Origin: "https://example.com" } }))).status).toBe(403);
    expect((await handler(new Request("http://127.0.0.1/api/documents/extra?kind=a"))).status).toBe(404);
    expect((await put("http://127.0.0.1/api/documents?kind=a&id=b", JSON.stringify({ revision: 0, value: 1 }), { "Content-Type": "application/json" })).status).toBe(403);
    expect((await put("http://127.0.0.1/api/documents?kind=a&id=b", JSON.stringify({ revision: 0, value: 1 }), { Origin: "http://127.0.0.1", "Content-Type": "text/plain" })).status).toBe(403);
    expect((await put("http://127.0.0.1/api/documents?kind=a&id=b", "{not json")).status).toBe(400);
    expect((await put("http://127.0.0.1/api/documents?kind=a&id=b", JSON.stringify({ revision: 0 }))).status).toBe(400);
    expect((await put("http://127.0.0.1/api/documents?kind=a&id=b", JSON.stringify({ revision: "x", value: 1 }))).status).toBe(400);
    expect((await handler(new Request("http://127.0.0.1/api/documents?kind=a", { method: "DELETE", headers: { Origin: "http://127.0.0.1" } }))).status).toBe(405);
    expect(store.list("a")).toEqual([]);
    expect((await put("http://127.0.0.1/api/documents?kind=a&id=b", JSON.stringify({ revision: 0, value: { ok: true } }))).status).toBe(200);
    expect((await put("http://127.0.0.1/api/documents?kind=a&id=b", JSON.stringify({ revision: 0, value: { ok: false } }))).status).toBe(409);
  } finally { file.close(); }
});

test("a saved document changes at once, writes one at a time with the newest value, and the newest edit here wins over one made elsewhere", async () => {
  const documents = storeDocuments();
  let puts = 0;
  const counted: DocumentStorePort = { list: documents.list, put: (...args) => { puts++; return documents.put(...args); } };
  const doc = savedDocument(counted, "sample", "a", { n: 0 });
  const saves = [doc.save({ n: 1 }), doc.save({ n: 2 }), doc.save({ n: 3 })];
  expect(doc.value).toEqual({ n: 3 });
  await Promise.all(saves);
  expect(puts).toBe(1);   // coalesced: the first write already sent the newest value
  expect(documents.store.get("sample", "a")).toMatchObject({ revision: 1, value: { n: 3 } });
  // Another window writes meanwhile; this page's next edit is written over it.
  documents.store.put("sample", "a", { n: 99 }, 1);
  await doc.save({ n: 4 });
  expect(documents.store.get("sample", "a")).toMatchObject({ revision: 3, value: { n: 4 } });
  // A store that can't take it rejects that save; the value stays as the person left it, and a later save goes through.
  const failing = savedDocument<{ n: number }>({ list: documents.list, put: async () => { throw new Error("offline"); } }, "sample", "b", { n: 0 });
  await expect(failing.save({ n: 1 })).rejects.toThrow("offline");
  expect(failing.value).toEqual({ n: 1 });
  await settle();
});
