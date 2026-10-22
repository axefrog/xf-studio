/**
 * The document store: typed, versioned documents in the library file, beside the released tables (user_version untouched),
 * reloaded from the same file, reached by the page over `/api/documents`, and held by the page as saved documents.
 */
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentsHandler } from "../src/platform/persistence/document-store";
import { browserDocuments } from "../src/app/browser/browser-documents-device";
import { documentOwners } from "../src/platform/core/saved-document";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import type { DocumentStorePort } from "../src/platform/api/document-store";
import { STUDIO_PARTS } from "../src/compose/studio-registry";
import { COLLECTION_FIXTURES, readFixture } from "./fixtures/capture-plan-golden";
import { alphaList } from "./fixtures/alpha-0.1.0/collection-list";
import { readRecipe } from "../src/legacy/eye-makeup/recipe-schema";
import { ManualClock, memoryOutboxStorage, settle, storeDocuments } from "./fixtures/platform-doubles";
import { openTestLibrary } from "./fixtures/library-file";

async function until(done: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!done()) { if (Date.now() > end) throw Error("Timed out."); await new Promise(resolve => setTimeout(resolve, 5)); }
}
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
  // Each collection is made at its own instant. Collections made in the same millisecond are ordered by when they were made here (their
  // rowid, LIB-01) and by their ID in 0.1.0-alpha.1, a released build that can't change: a tie has no order both builds share.
  try {
    COLLECTION_FIXTURES.forEach((fixture, index) => {
      setSystemTime(new Date(Date.UTC(2026, 9, 22, 12, 0, 0, index)));
      file.collections.save({ collection: STUDIO_PARTS.readCollection(readFixture(fixture)) });
    });
  } finally { setSystemTime(); }
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

test("the page's transport: the browser device lists, commits, checks and reads through the host endpoint", async () => {
  const file = openTestLibrary(), store = file.documents, handler = createDocumentsHandler(store, "/api/documents");
  try {
    const page = browserDocuments("/api/documents", (url, init) => handler(new Request(`http://127.0.0.1:4317${url}`,
      { ...init, headers: { ...(init?.headers as Record<string, string>), Origin: "http://127.0.0.1:4317" } })));
    expect(await page.list("sample")).toEqual([]);
    const ref = { kind: "sample", id: "id with spaces/and slashes" };
    expect(await page.transact({ id: "c-1", command: "sample.write", writes: [{ ...ref, base: 0, value: { a: 1 } }] }))
      .toEqual({ ok: true, revisions: { "sample/id with spaces/and slashes": 1 } });
    expect((await page.list("sample")).map(item => [item.id, item.value])).toEqual([["id with spaces/and slashes", { a: 1 }]]);
    expect(await page.transact({ id: "c-2", command: "sample.write", writes: [{ ...ref, base: 0, value: { a: 2 } }] }))
      .toEqual({ ok: false, reason: "stale", current: { "sample/id with spaces/and slashes": { revision: 1, value: { a: 1 } } } });
    expect(await page.revisions([ref, { kind: "sample", id: "none" }])).toEqual({ "sample/id with spaces/and slashes": 1, "sample/none": 0 });
    expect(await page.read([ref])).toEqual({ "sample/id with spaces/and slashes": { revision: 1, value: { a: 1 } } });
    await expect(page.transact({ id: "c-3", command: "sample.write", writes: [{ kind: "Not a kind", id: "x", base: 0, value: 1 }] })).rejects.toThrow("kind");
  } finally { file.close(); }
});

test("the endpoint answers local, same-origin pages only, and refuses what isn't a command", async () => {
  const file = openTestLibrary(), store = file.documents, handler = createDocumentsHandler(store, "/api/documents");
  const post = (url: string, body: string, headers: Record<string, string> = { Origin: "http://127.0.0.1", "Content-Type": "application/json" }) =>
    handler(new Request(url, { method: "POST", headers, body }));
  const command = (value: unknown, base = 0) => JSON.stringify({ id: `c-${Math.random()}`, command: "a.write", writes: [{ kind: "a", id: "b", base, value }] });
  try {
    expect((await handler(new Request("http://example.com/api/documents?kind=a"))).status).toBe(403);
    expect((await handler(new Request("http://127.0.0.1/api/documents?kind=a", { headers: { Origin: "https://example.com" } }))).status).toBe(403);
    expect((await handler(new Request("http://127.0.0.1/api/documents/extra?kind=a"))).status).toBe(404);
    expect((await post("http://127.0.0.1/api/documents/transact", command(1), { "Content-Type": "application/json" })).status).toBe(403);
    expect((await post("http://127.0.0.1/api/documents/transact", command(1), { Origin: "http://127.0.0.1", "Content-Type": "text/plain" })).status).toBe(403);
    expect((await post("http://127.0.0.1/api/documents/transact", "{not json")).status).toBe(400);
    expect((await post("http://127.0.0.1/api/documents/transact", JSON.stringify({ id: "x", command: "a.write", writes: [{ kind: "a", id: "b", base: "x", value: 1 }] }))).status).toBe(400);
    // There is no single-document write: commands are the only writes.
    expect((await handler(new Request("http://127.0.0.1/api/documents?kind=a&id=b", { method: "PUT", headers: { Origin: "http://127.0.0.1", "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 0, value: 1 }) }))).status).toBe(405);
    expect((await handler(new Request("http://127.0.0.1/api/documents?kind=a", { method: "DELETE", headers: { Origin: "http://127.0.0.1" } }))).status).toBe(405);
    expect(store.list("a")).toEqual([]);
    expect(await (await post("http://127.0.0.1/api/documents/transact", command({ ok: true }))).json()).toMatchObject({ ok: true });
    expect(await (await post("http://127.0.0.1/api/documents/transact", command({ ok: false }))).json()).toMatchObject({ ok: false, reason: "stale" });
  } finally { file.close(); }
});

test("a saved document changes at once, reaches the library through the outbox with the newest value, and a stale one waits as a conflict", async () => {
  const documents = storeDocuments();
  let commands = 0;
  const counted: DocumentStorePort = { ...documents, transact: request => { commands++; return documents.transact(request); } };
  const outbox = new DocumentOutbox(counted, memoryOutboxStorage(), { retryMs: 5 });
  outbox.open();
  const owners = documentOwners(outbox);
  const doc = owners.open("sample", "a", { n: 0 });
  const saves = [doc.save({ n: 1 }), doc.save({ n: 2 }), doc.save({ n: 3 })];
  expect(doc.value).toEqual({ n: 3 });
  await Promise.all(saves);
  expect(commands).toBe(1);   // coalesced: one command carried the newest value
  expect(documents.store.get("sample", "a")).toMatchObject({ revision: 1, value: { n: 3 } });
  // Another window writes meanwhile: this page's next edit becomes a conflict, never written over theirs; Keep mine sends it.
  documents.store.transact({ id: "other", command: "x", writes: [{ kind: "sample", id: "a", base: 1, value: { n: 99 } }] });
  const mine = doc.save({ n: 4 });
  await until(() => outbox.conflicts().length === 1);
  expect(documents.store.get("sample", "a")).toMatchObject({ revision: 2, value: { n: 99 } });
  outbox.keepMine(outbox.conflicts()[0]!.id);
  await mine;
  expect(documents.store.get("sample", "a")).toMatchObject({ revision: 3, value: { n: 4 } });
  // A new document starts at its initial value and is recorded when the owners settle.
  const fresh = owners.open("sample", "b", { n: 0 });
  expect(fresh.value).toEqual({ n: 0 });
  expect(await owners.settle()).toBe(true);
  expect(documents.store.get("sample", "b")).toMatchObject({ revision: 1, value: { n: 0 } });
  await settle();
});
