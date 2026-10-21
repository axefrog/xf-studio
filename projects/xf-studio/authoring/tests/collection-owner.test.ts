/**
 * Profiles phase 1, chunk 1c-ii: collections and looks on the outbox (profiles design §1, §2.1, §7). The collection owner's commands
 * (one all-or-nothing command each) and look sessions with several collections and looks open at once; coherent snapshots and Save
 * version; removal, tombstones and the host's retention; receipts that know their workspace (the 1c-i known limit); Keep both over
 * existing membership documents.
 */
import { describe, expect, test } from "bun:test";
import { DocumentOutbox, OutboxRecoveringError } from "../src/platform/core/document-outbox";
import { documentKey, isTombstone, tombstoneOf, type TransactAnswer } from "../src/platform/api/document-commands";
import type { DocumentStorePort, WorkspaceFence } from "../src/platform/api/document-store";
import { memoryOutboxStorage, storeDocuments } from "./fixtures/platform-doubles";
import { desktopOutboxStorage } from "../src/app/browser/outbox-storage";
import { openTestLibrary } from "./fixtures/library-file";
import { CollectionOwner, type CollectionVersionsPort } from "../src/library/collection-owner";
import { LookSessions } from "../src/library/look-sessions";
import { COLLECTION_WORKING, collectionRef, LOOK_WORKING, lookRef, REMOVED_FOR_MS, REMOVED_LIMIT } from "../src/library/collection-documents";
import { saveCollectionVersion } from "../src/library/host/collection-store";
import { STUDIO_PARTS } from "../src/compose/studio-registry";
import { COLLECTION_FIXTURES, readFixture } from "./fixtures/capture-plan-golden";
import { TOMBSTONE_TTL_MS } from "../src/platform/persistence/document-store";

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const DOC = { kind: "look-working", id: "c/l" };
const DAY = 24 * 3600_000;

/** A port onto `store` that sends `fence` with every command (as the page's transport does), and can lose answers after the commit. */
function fenced(documents: ReturnType<typeof storeDocuments>, fence: () => WorkspaceFence | null) {
  let lose = 0;
  const port: DocumentStorePort = { ...documents, async transact(request): Promise<TransactAnswer> {
    const answer = documents.store.transact(request, fence());
    if (lose > 0) { lose--; throw Error("The answer was lost."); }
    return answer;
  } };
  return { port, lose(n: number) { lose = n; } };
}
async function quiet(outbox: DocumentOutbox) { for (let i = 0; i < 200 && (outbox.status().pending || outbox.status().failing); i++) await tick(2); }

describe("receipts know their workspace: no false conflict after a crash with host writes pending (1c-i known limit)", () => {
  test("a replay answered from its receipt names the documents every later revision of which the same workspace wrote", () => {
    const { store } = storeDocuments();
    const w = { workspace: "desktop", generation: store.nextLease("desktop") };
    store.transact({ id: "e1", command: "x", writes: [{ ...DOC, base: 0, value: { n: 1 } }] }, w);
    store.transact({ id: "e2", command: "x", writes: [{ ...DOC, base: 1, value: { n: 2 } }] }, w);
    expect(store.get("xfs-receipt", "e1")!.value).toEqual({ command: "x", revisions: { [documentKey(DOC)]: 1 }, workspace: "desktop", generation: w.generation });
    // The next launch (a newer generation) replays e1.
    const next = { workspace: "desktop", generation: store.nextLease("desktop") };
    expect(store.transact({ id: "e1", command: "x", writes: [{ ...DOC, base: 0, value: { n: 1 } }] }, next))
      .toEqual({ ok: true, revisions: { [documentKey(DOC)]: 1 }, replayed: "receipt", own: { [documentKey(DOC)]: { revision: 2, value: { n: 2 } } } });
    // Another workspace's replay of the same command learns nothing of it; nor does one with no lease.
    expect(store.transact({ id: "e1", command: "x", writes: [{ ...DOC, base: 0, value: { n: 1 } }] }, { workspace: "browser-2", generation: 9 })).not.toHaveProperty("own");
    expect(store.transact({ id: "e1", command: "x", writes: [{ ...DOC, base: 0, value: { n: 1 } }] })).not.toHaveProperty("own");
    // Another workspace writes revision 3: the later revisions are no longer all this workspace's own.
    store.transact({ id: "b1", command: "x", writes: [{ ...DOC, base: 2, value: { n: "b" } }] }, { workspace: "browser-2", generation: 1 });
    expect(store.transact({ id: "e1", command: "x", writes: [{ ...DOC, base: 0, value: { n: 1 } }] }, next)).not.toHaveProperty("own");
    // A revision whose receipt is gone (forgotten, purged) is never assumed to be this workspace's own.
    const fresh = storeDocuments().store, g = { workspace: "desktop", generation: fresh.nextLease("desktop") };
    fresh.transact({ id: "e1", command: "x", writes: [{ ...DOC, base: 0, value: 1 }] }, g);
    fresh.transact({ id: "e2", command: "x", writes: [{ ...DOC, base: 1, value: 2 }] }, g);
    fresh.transact({ id: "e3", command: "x", writes: [{ ...DOC, base: 2, value: 3 }], forget: ["e2"] }, g);
    expect(fresh.transact({ id: "e1", command: "x", writes: [{ ...DOC, base: 0, value: 1 }] }, g)).not.toHaveProperty("own");
  });

  test("the S1 desktop host-kill case: a new launch replays an older host copy; no edit is made over it, and none conflicts with its own later write", async () => {
    for (const other of [false, true]) {
      const documents = storeDocuments(), store = documents.store;
      let fence: WorkspaceFence = { workspace: "desktop", generation: store.nextLease("desktop") };
      const { port } = fenced(documents, () => fence);
      // The host's copy of each key: its writes land only when the test lets them (the app dies with later ones still on their way).
      const host: Record<string, string> = {}, waiting: { key: string; text: string | null; done(): void }[] = [];
      const webview = new Map<string, string>();
      const local = { get length() { return webview.size; }, key: (i: number) => [...webview.keys()][i] ?? null, getItem: (key: string) => webview.get(key) ?? null,
        setItem: (key: string, text: string) => { webview.set(key, text); }, removeItem: (key: string) => { webview.delete(key); } };
      const storageFor = (launch: string) => desktopOutboxStorage(local, "desktop", launch, { ...host }, (key, text) =>
        new Promise<void>(resolve => { waiting.push({ key, text, done: resolve }); }));
      const land = (n: number) => { for (const write of waiting.splice(0, n)) { if (write.text === null) delete host[write.key]; else host[write.key] = write.text; write.done(); } };
      const first = new DocumentOutbox(port, storageFor("one"), { retryMs: 5 });
      first.hold(DOC, null); first.open();
      // Shape A, then (acknowledged later) shape B with more work in it.
      const e1 = first.commit("look.update", [{ ...DOC, value: { shape: "A", name: "Look" } }]);
      land(1);   // the host's copy holds e1
      await quiet(first);
      first.commit("look.update", [{ ...DOC, value: { shape: "B", name: "Look" } }]);
      await quiet(first);
      expect(store.get(DOC.kind, DOC.id)!.revision).toBe(2);
      // The app dies: every later host write of the key is lost, so the next launch reads e1 back from the host's copy.
      first.stop(); waiting.splice(0);
      if (other) store.transact({ id: "b", command: "x", writes: [{ ...DOC, base: 2, value: { shape: "theirs", name: "Look" } }] }, { workspace: "browser-9", generation: 1 });
      fence = { workspace: "desktop", generation: store.nextLease("desktop") };
      const second = new DocumentOutbox(port, storageFor("two"), { retryMs: 5 });
      second.hold(DOC, store.read([DOC])[documentKey(DOC)]!);
      second.open();
      expect(second.pendingEntries().map(entry => entry.id)).toEqual([e1.id]);
      // A rename while e1 is replayed would be made over shape A: it waits for the replay's answer (finding 1 of the 1c-ii review).
      expect(second.recovering(DOC)).toBe(true);
      expect(() => second.commit("look.update", [{ ...DOC, value: { shape: "A", name: "Renamed" } }])).toThrow(OutboxRecoveringError);
      await quiet(second);
      expect(second.recovering(DOC)).toBe(false);
      const now = second.document(DOC)!.value as { shape: string };
      expect(now.shape).toBe(other ? "theirs" : "B");
      second.commit("look.update", [{ ...DOC, value: { ...now, name: "Renamed" } }]);
      await quiet(second);
      expect(second.conflicts()).toEqual([]);
      expect(store.get(DOC.kind, DOC.id)).toMatchObject({ revision: other ? 4 : 3, value: { shape: other ? "theirs" : "B", name: "Renamed" } });
      second.stop();
    }
  });

  test("own: a replay answered by its receipt adopts this workspace's later revision as the baseline, and its successors still go over the receipt's", async () => {
    const documents = storeDocuments(), store = documents.store;
    const fence: WorkspaceFence = { workspace: "w", generation: store.nextLease("w") };
    const { port } = fenced(documents, () => fence);
    // Committed earlier by this workspace: e1 (A) then e2 (B). The page holds only e1, as a stored copy, plus a stored successor of it
    // that was never sent; it never read the document.
    store.transact({ id: "e1", command: "x", writes: [{ ...DOC, base: 0, value: { shape: "A" } }] }, fence);
    store.transact({ id: "e2", command: "x", writes: [{ ...DOC, base: 1, value: { shape: "B" } }] }, fence);
    const storage = memoryOutboxStorage();
    storage.keys.set(documentKey(DOC), JSON.stringify({ schema: "xfs/outbox-1", stamp: 2, entries: [
      { id: "e1", seq: 1, command: "x", writes: [{ ...DOC, base: 0, value: { shape: "A" } }], at: 0, state: "queued", stamp: 1 },
      { id: "s", seq: 2, command: "x", writes: [{ ...DOC, base: { after: "e1" }, value: { shape: "A", name: "stale" } }], at: 0, state: "queued", stamp: 2 }] }));
    const outbox = new DocumentOutbox(port, storage, { retryMs: 5 });
    outbox.open();
    await quiet(outbox);
    // The successor went over revision 1 (what e1 produced), so it is a conflict against B, never written over it.
    expect(outbox.conflicts().map(entry => entry.id)).toEqual(["s"]);
    expect(store.get(DOC.kind, DOC.id)!.value).toEqual({ shape: "B" });
    outbox.useTheirs("s");
    expect(outbox.document(DOC)).toMatchObject({ revision: 2, value: { shape: "B" } });
  });
});

describe("the host's retention (§1.4): a background job, in one transaction", () => {
  test("tombstones go 30 days after they were written, with a purged collection's looks; unreferenced decoded saves go; roots stay", () => {
    let now = 1_000_000_000_000;
    const { store } = storeDocuments();
    (store as unknown as { options: { now: () => number } }).options.now = () => now;
    const put = (kind: string, id: string, value: unknown) => { const base = store.get(kind, id)?.revision ?? 0; store.put(kind, id, value, base); };
    put("saved-v", "s-used", { save: 1 }); put("saved-v", "s-deleted-v", { save: 2 }); put("saved-v", "s-orphan", { save: 3 });
    put("character", "c-live", { source: { kind: "save", decoded: "s-used" } });
    put("character", "c-gone", tombstoneOf({ source: { kind: "save", decoded: "s-deleted-v" } }, now));
    put("character", "c-orphan", { name: "no profile lists me" });
    put("profile", "p-1", { subjects: [] });
    put(COLLECTION_WORKING, "col-gone", tombstoneOf({ name: "Old" }, now));
    put(LOOK_WORKING, "col-gone/l1", { name: "a" }); put(LOOK_WORKING, "col-gone/l2", { name: "b" });
    put(COLLECTION_WORKING, "col-live", { name: "Kept" }); put(LOOK_WORKING, "col-live/l1", { name: "c" });
    put(LOOK_WORKING, "col-live/l2", tombstoneOf({ name: "pushed out" }, now + 10 * DAY));
    store.transact({ id: "r-old", command: "x", writes: [{ kind: "sample", id: "x", base: 0, value: 1 }] });
    // 29 days later nothing has expired; the decoded saves are too new to judge.
    now += 29 * DAY;
    expect(store.cleanup()).toEqual({ receipts: 1, tombstones: 0, children: 0, orphans: 0 });
    now += 2 * DAY;
    expect(store.cleanup()).toEqual({ receipts: 0, tombstones: 2, children: 2, orphans: 2 });
    const left = (kind: string) => store.list(kind).map(doc => doc.id);
    expect(left("character")).toEqual(["c-live", "c-orphan"]);
    expect(left("saved-v")).toEqual(["s-used"]);
    expect(left("profile")).toEqual(["p-1"]);
    expect(left(COLLECTION_WORKING)).toEqual(["col-live"]);
    expect(left(LOOK_WORKING)).toEqual(["col-live/l1", "col-live/l2"]);
    now += 10 * DAY;
    expect(store.cleanup()).toMatchObject({ tombstones: 1 });
    expect(left(LOOK_WORKING)).toEqual(["col-live/l1"]);
    expect(TOMBSTONE_TTL_MS).toBe(30 * DAY);
  });

  test("the hosts run it on their clock, a minute after start and daily, until the files close", async () => {
    const { keepLibraryClean, CLEANUP_FIRST_MS, CLEANUP_EVERY_MS } = await import("../src/platform/persistence/document-store");
    const { ManualClock } = await import("./fixtures/platform-doubles");
    const clock = new ManualClock(0), life = new AbortController();
    let runs = 0;
    keepLibraryClean({ cleanup: () => { runs++; return { receipts: 0, tombstones: 0, children: 0, orphans: 0 }; } } as never, clock, life.signal);
    clock.advance(CLEANUP_FIRST_MS - 1); expect(runs).toBe(0);
    clock.advance(1); expect(runs).toBe(1);
    clock.advance(CLEANUP_EVERY_MS); expect(runs).toBe(2);
    life.abort(); clock.advance(CLEANUP_EVERY_MS); expect(runs).toBe(2);
  });
});

/** A window: the outbox over the shared library, the collection owner and its look sessions. */
function windowOn(documents: ReturnType<typeof storeDocuments>, options: { storage?: ReturnType<typeof memoryOutboxStorage>; now?: () => number; versions?: CollectionVersionsPort; port?: DocumentStorePort } = {}) {
  const storage = options.storage ?? memoryOutboxStorage();
  const outbox = new DocumentOutbox(options.port ?? documents, storage, { retryMs: 5 });
  let n = 0;
  const owner = new CollectionOwner({ documents: options.port ?? documents, outbox, now: options.now, versions: options.versions,
    newId: () => `${crypto.randomUUID().slice(0, 30)}${(++n).toString(16).padStart(6, "0")}` });
  const sessions = new LookSessions(owner, outbox);
  return { outbox, owner, sessions, storage, async start() { await owner.load(); outbox.open(); owner.expire(); } };
}
const expectOk = <T extends { ok: boolean }>(answer: T): T & { ok: true } => { expect(answer).toMatchObject({ ok: true }); return answer as T & { ok: true }; };
const parts = (n: number) => ({ "eye-makeup": { schema: "test", body: { n } } });

describe("the collection owner: several collections and looks at once, each command all or nothing", () => {
  test("commands on three collections and their looks never touch another's documents, and the library ends equal to what the window shows", async () => {
    const documents = storeDocuments(), w = windowOn(documents);
    await w.start();
    const ids = ["One", "Two", "Three"].map(name => expectOk(w.owner.dispatch({ kind: "collection.create", name, looks: [{ name: `${name} a`, parts: parts(1) }, { name: `${name} b`, parts: parts(2) }] })).collection);
    const rev = (id: string) => w.owner.collection(id)!.revision;
    const [a, b, c] = ids as [string, string, string];
    // Open every look at once, and edit each through its own session.
    const open = ids.flatMap(id => w.owner.looksOf(id).map(look => w.sessions.open(look.ref)));
    expect(w.sessions.held().length).toBe(6);
    const heard = new Map(open.map(session => [session, 0]));
    for (const session of open) session.subscribe(() => heard.set(session, heard.get(session)! + 1));
    open.forEach((session, i) => expect(session.update({ parts: parts(100 + i) })).toMatchObject({ ok: true }));
    // Each session heard its own look only.
    expect([...heard.values()]).toEqual(open.map(() => 1));
    expectOk(w.owner.dispatch({ kind: "collection.rename", collection: b, base: rev(b), name: "Two renamed" }));
    const copied = expectOk(w.owner.dispatch({ kind: "collection.copyLook", collection: c, base: rev(c), from: open[0]!.ref }));
    const added = expectOk(w.owner.dispatch({ kind: "collection.addLook", collection: a, base: rev(a), look: { name: "Added", parts: parts(7) }, at: 0 }));
    expectOk(w.owner.dispatch({ kind: "collection.removeLook", collection: b, base: rev(b), look: open[2]!.ref.look }));
    expect(w.owner.dispatch({ kind: "collection.rename", collection: a, base: rev(a) - 1, name: "x" })).toMatchObject({ ok: false, code: "stale" });
    expect(open[2]!.update({ name: "edit a removed look" })).toMatchObject({ ok: false, code: "unavailable" });
    await quiet(w.outbox);
    expect(w.outbox.status()).toMatchObject({ pending: 0, conflicts: 0 });
    // Collection one: the added look first, then its own two; collection three: its two and the copy of one's first look.
    expect(w.owner.looksOf(a).map(look => look.name)).toEqual(["Added", "One a", "One b"]);
    expect(w.owner.looksOf(b).map(look => look.name)).toEqual(["Two b"]);
    expect(w.owner.collection(b)!.name).toBe("Two renamed");
    expect(w.owner.looksOf(c).map(look => [look.name, look.parts])).toEqual([["Three a", parts(104)], ["Three b", parts(105)], ["One a (copy)", parts(100)]]);
    expect(copied.look!.collection).toBe(c); expect(added.look!.collection).toBe(a);
    expect(w.owner.restorable(b).map(item => item.name)).toEqual(["Two a"]);
    // The library holds exactly what the window shows, for every document.
    for (const doc of [...documents.store.list(COLLECTION_WORKING), ...documents.store.list(LOOK_WORKING)])
      expect(w.outbox.document({ kind: doc.kind, id: doc.id })!.value).toEqual(doc.value);
    // A second window reads the same.
    const other = windowOn(documents);
    await other.start();
    expect(other.owner.list().map(view => [view.name, other.owner.looksOf(view.id).map(look => look.name)]))
      .toEqual(w.owner.list().map(view => [view.name, w.owner.looksOf(view.id).map(look => look.name)]));
    // Sessions close with their last handle, once their changes are in the library.
    const again = w.sessions.open(open[0]!.ref);
    expect(await open[0]!.release()).toBe(true);
    expect(w.sessions.held().length).toBe(6);
    expect(await again.release()).toBe(true);
    for (const session of open.slice(1)) expect(await session.release()).toBe(true);
    expect(w.sessions.held()).toEqual([]);
  });

  test("removal: restorable while listed; the 21st removal pushes the oldest out as a tombstone in the same command; 30 days expire it", async () => {
    let now = 1_000_000_000_000;
    const documents = storeDocuments(), w = windowOn(documents, { now: () => now });
    await w.start();
    const id = expectOk(w.owner.dispatch({ kind: "collection.create", name: "Many", looks: Array.from({ length: 23 }, (_, i) => ({ name: `L${i}`, parts: parts(i) })) })).collection;
    const looks = w.owner.looksOf(id).map(look => look.ref.look);
    for (let i = 0; i < REMOVED_LIMIT; i++) { now += 1000; expectOk(w.owner.dispatch({ kind: "collection.removeLook", collection: id, base: w.owner.collection(id)!.revision, look: looks[i]! })); }
    expect(w.owner.restorable(id).length).toBe(REMOVED_LIMIT);
    expect(w.owner.look({ collection: id, look: looks[0]! })!.state).toBe("removed");
    now += 1000;
    const before = w.outbox.pendingEntries().length;
    expectOk(w.owner.dispatch({ kind: "collection.removeLook", collection: id, base: w.owner.collection(id)!.revision, look: looks[20]! }));
    // One command: the collection, the removed look and the pushed-out look's tombstone.
    const entry = w.outbox.pendingEntries().at(-1)!;
    expect(w.outbox.pendingEntries().length).toBe(before + 1);
    expect(entry.writes.map(write => write.id)).toEqual([id, `${id}/${looks[20]}`, `${id}/${looks[0]}`]);
    expect(isTombstone(entry.writes[2]!.value)).toBe(true);
    expect(w.owner.look({ collection: id, look: looks[0]! })).toBeNull();
    expect(w.owner.restorable(id).map(item => item.look)).not.toContain(looks[0]);
    expectOk(w.owner.dispatch({ kind: "collection.restoreLook", collection: id, base: w.owner.collection(id)!.revision, look: looks[5]! }));
    expect(w.owner.looksOf(id).map(look => look.name).at(-1)).toBe("L5");
    expect(w.owner.dispatch({ kind: "collection.restoreLook", collection: id, base: w.owner.collection(id)!.revision, look: looks[0]! })).toMatchObject({ ok: false });
    await quiet(w.outbox);
    // 30 days on, a new window's load expires the rest in one command of its own.
    now += REMOVED_FOR_MS;
    const later = windowOn(documents, { now: () => now });
    await later.start();
    expect(later.owner.restorable(id)).toEqual([]);
    await quiet(later.outbox);
    const stored = documents.store.get<{ removed: unknown[] }>(COLLECTION_WORKING, id)!.value;
    expect(stored.removed).toEqual([]);
    expect(documents.store.list(LOOK_WORKING).filter(doc => isTombstone(doc.value)).length).toBe(REMOVED_LIMIT);
  });

  test("a collection delete is a tombstone; its looks are kept with it and purged with it", async () => {
    const documents = storeDocuments(), w = windowOn(documents);
    await w.start();
    const id = expectOk(w.owner.dispatch({ kind: "collection.create", name: "Gone", looks: [{ name: "x" }] })).collection;
    expectOk(w.owner.dispatch({ kind: "collection.delete", collection: id, base: w.owner.collection(id)!.revision }));
    expect(w.owner.list()).toEqual([]);
    await quiet(w.outbox);
    expect(isTombstone(documents.store.get(COLLECTION_WORKING, id)!.value)).toBe(true);
    expect(documents.store.list(LOOK_WORKING).length).toBe(1);
  });
});

describe("conflicts between windows on collections and looks", () => {
  /** Two windows on one library; B's changes reach the library while A's command is still unsent, so A's goes stale. */
  async function pair() {
    const documents = storeDocuments(), a = windowOn(documents), b = windowOn(documents);
    await a.start();
    const id = expectOk(a.owner.dispatch({ kind: "collection.create", name: "Shared", looks: [{ name: "First", parts: parts(1) }, { name: "Second", parts: parts(2) }] })).collection;
    await quiet(a.outbox);
    await b.start();
    return { documents, a, b, id };
  }

  test("a look edited in both: Keep both keeps theirs and adds mine as \"(this window)\" right after it, over the collection as it is now", async () => {
    const { documents, a, b, id } = await pair();
    const [first] = a.owner.looksOf(id);
    // B renames the collection and edits the look; A edits the same look.
    expectOk(b.owner.dispatch({ kind: "collection.rename", collection: id, base: b.owner.collection(id)!.revision, name: "Renamed by B" }));
    b.sessions.open(first!.ref).update({ parts: parts(20) });
    await quiet(b.outbox);
    const mine = a.sessions.open(first!.ref);
    const events: string[] = [];
    mine.subscribe(event => events.push(event.kind));
    mine.update({ parts: parts(10) });
    await quiet(a.outbox);
    expect(mine.look()!.conflict).not.toBeNull();
    expect(events).toContain("conflict");
    expect(await mine.resolve("both")).toEqual({ available: true });
    await quiet(a.outbox);
    expect(a.owner.conflicts()).toEqual([]);
    // Theirs kept (the rename and the look's parts); mine is a new look right after the original; nothing of B's was written over.
    const stored = documents.store.get<{ name: string; looks: string[] }>(COLLECTION_WORKING, id)!.value;
    expect(stored.name).toBe("Renamed by B");
    expect(a.owner.looksOf(id).map(look => [look.name, look.parts])).toEqual([["First", parts(20)], ["First (this window)", parts(10)], ["Second", parts(2)]]);
    expect(stored.looks).toEqual([...a.owner.collection(id)!.looks]);
  });

  test("Use theirs on a look keeps mine as a fork too; on a collection alone it takes theirs; Keep mine writes mine over theirs", async () => {
    const { documents, a, b, id } = await pair();
    const [first, second] = a.owner.looksOf(id);
    b.sessions.open(first!.ref).update({ name: "B's name" });
    expectOk(b.owner.dispatch({ kind: "collection.reorder", collection: id, base: b.owner.collection(id)!.revision, looks: [second!.ref.look, first!.ref.look] }));
    await quiet(b.outbox);
    a.sessions.open(first!.ref).update({ name: "A's name" });
    expectOk(a.owner.dispatch({ kind: "collection.rename", collection: id, base: a.owner.collection(id)!.revision, name: "A's collection" }));
    await quiet(a.outbox);
    const conflicts = a.owner.conflicts();
    expect(conflicts.length).toBe(2);
    const onLook = conflicts.find(entry => entry.writes[0]!.kind === LOOK_WORKING)!, onCollection = conflicts.find(entry => entry.writes[0]!.kind === COLLECTION_WORKING)!;
    expect(await a.owner.resolve(onCollection.id, "both")).toMatchObject({ available: false });
    expect(await a.owner.resolve(onCollection.id, "theirs")).toEqual({ available: true });
    expect(await a.owner.resolve(onLook.id, "theirs")).toEqual({ available: true });
    await quiet(a.outbox);
    expect(a.owner.looksOf(id).map(look => look.name)).toEqual(["Second", "B's name", "A's name (this window)"]);
    expect(a.owner.collection(id)!.name).toBe("Shared");
    // Keep mine: an explicit command over theirs.
    await b.outbox.check();
    expectOk(b.owner.dispatch({ kind: "collection.rename", collection: id, base: b.owner.collection(id)!.revision, name: "B again" }));
    await quiet(b.outbox);
    expectOk(a.owner.dispatch({ kind: "collection.rename", collection: id, base: a.owner.collection(id)!.revision, name: "A again" }));
    await quiet(a.outbox);
    expect(await a.owner.resolve(a.owner.conflicts()[0]!.id, "mine")).toEqual({ available: true });
    await quiet(a.outbox);
    expect(documents.store.get<{ name: string }>(COLLECTION_WORKING, id)!.value.name).toBe("A again");
  });

  test("Keep both on a stale multi-document command (a look added while another window changed the collection) keeps theirs' collection", async () => {
    const { documents, a, b, id } = await pair();
    expectOk(b.owner.dispatch({ kind: "collection.rename", collection: id, base: b.owner.collection(id)!.revision, name: "B's" }));
    expectOk(b.owner.dispatch({ kind: "collection.addLook", collection: id, base: b.owner.collection(id)!.revision, look: { name: "B's look" } }));
    await quiet(b.outbox);
    expectOk(a.owner.dispatch({ kind: "collection.addLook", collection: id, base: a.owner.collection(id)!.revision, look: { name: "A's look", parts: parts(9) } }));
    await quiet(a.outbox);
    const [conflict] = a.owner.conflicts();
    expect(conflict!.writes.map(write => write.kind)).toEqual([COLLECTION_WORKING, LOOK_WORKING]);
    expect(await a.owner.resolve(conflict!.id, "both")).toEqual({ available: true });
    await quiet(a.outbox); await tick(5);
    // B's rename and B's look stay; A's look is kept as a fork at the end (its original was never in theirs).
    expect(documents.store.get<{ name: string }>(COLLECTION_WORKING, id)!.value.name).toBe("B's");
    expect(a.owner.looksOf(id).map(look => look.name)).toEqual(["First", "Second", "B's look", "A's look (this window)"]);
    expect(b.owner.looksOf(id).length).toBe(3);
    await b.outbox.check(); await tick(5);
    expect(b.owner.looksOf(id).map(look => look.name)).toEqual(a.owner.looksOf(id).map(look => look.name));
  });
});

describe("coherent snapshots and Save version (§2.1)", () => {
  const fixture = () => STUDIO_PARTS.readCollection(readFixture(COLLECTION_FIXTURES[0]!));

  test("Save version flushes, then the host writes a named version older builds read from its own snapshot, in one transaction", async () => {
    const file = openTestLibrary(":memory:");
    const documents = { store: file.documents, list: async (kind: string) => file.documents.list(kind), transact: async (request: never) => file.documents.transact(request),
      revisions: async (refs: never) => file.documents.revisions(refs), read: async (refs: never) => file.documents.read(refs) } as unknown as ReturnType<typeof storeDocuments>;
    const versions: CollectionVersionsPort = { save: async id => saveCollectionVersion(file.collections, file.documents, file.database, id) };
    const w = windowOn(documents, { versions });
    await w.start();
    const source = fixture();
    const id = expectOk(w.owner.dispatch({ kind: "collection.create", id: source.id, name: source.name,
      looks: source.presets.map(preset => ({ id: preset.id, name: preset.name, parts: JSON.parse(JSON.stringify(preset.parts)) })) })).collection;
    // An edit still unsent when Ctrl+S is pressed is in the version.
    const look = w.owner.looksOf(id)[0]!;
    w.sessions.open(look.ref).update({ name: "Renamed before saving" });
    const saved = await w.owner.saveVersion(id);
    if (!saved.ok) throw Error(saved.reason);
    expect(saved.version.revision).toBe(1);
    const released = file.collections.get(id);
    expect(released.collection.presets.map(preset => preset.name)).toEqual(w.owner.looksOf(id).map(view => view.name));
    expect(released.collection.presets[0]!.name).toBe("Renamed before saving");
    // Made from the working copies as the flush left them: the collection's first revision, the renamed look's second.
    expect(saved.version.documents[documentKey(collectionRef(id))]).toBe(1);
    expect(saved.version.documents[documentKey(lookRef(look.ref))]).toBe(2);
    await quiet(w.outbox);
    expect(w.owner.collection(id)!.saved).toEqual({ revision: 1 });
    // A second version over it, and the snapshot (export) reads the same documents in one read.
    expectOk(w.owner.dispatch({ kind: "collection.removeLook", collection: id, base: w.owner.collection(id)!.revision, look: look.ref.look }));
    const second = await w.owner.saveVersion(id);
    expect(second).toMatchObject({ ok: true, version: { revision: 2 } });
    expect(file.collections.get(id).collection.presets.length).toBe(source.presets.length - 1);
    const snapshot = await w.owner.snapshot(id);
    if (!("collection" in snapshot)) throw Error(snapshot.reason);
    expect(snapshot.looks.map(item => item.name)).toEqual(w.owner.looksOf(id).map(view => view.name));
    expect(Object.keys(snapshot.revisions).length).toBe(source.presets.length);
    file.close();
  });

  test("a snapshot or save with changes that can't reach the library, or in conflict, is refused and nothing is written", async () => {
    const documents = storeDocuments();
    let down = false;
    const port: DocumentStorePort = { ...documents, async transact(request) { if (down) throw Error("The host didn't answer."); return documents.store.transact(request); } };
    let saves = 0;
    const w = windowOn(documents, { port, versions: { save: async () => { saves++; return { revision: 1, updatedAt: "", documents: {} }; } } });
    await w.start();
    const id = expectOk(w.owner.dispatch({ kind: "collection.create", name: "Offline", looks: [{ name: "x" }] })).collection;
    down = true;
    expect(await w.owner.saveVersion(id)).toMatchObject({ ok: false, code: "unavailable" });
    expect(await w.owner.snapshot(id)).toMatchObject({ available: false, code: "unavailable" });
    expect(saves).toBe(0);
    down = false;
    await quiet(w.outbox);
    expect(await w.owner.saveVersion(id)).toMatchObject({ ok: true });
  });
});

describe("a crash at any point loses nothing acknowledged, with several collections and looks open (seeded runs)", () => {
  type Model = { collections: Record<string, { name: string; looks: string[]; removed: string[] }>; looks: Record<string, { name: string; parts: unknown; state: string } | null> };
  function random(seed: number) {
    let state = seed >>> 0;
    const next = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]! };
  }
  /** What the window shows, in the model's terms. */
  function shown(owner: CollectionOwner, model: Model): Model {
    const collections: Model["collections"] = {}, looks: Model["looks"] = {};
    for (const id of Object.keys(model.collections)) {
      const view = owner.collection(id);
      if (view) collections[id] = { name: view.name, looks: [...view.looks], removed: view.removed.map(item => item.look) };
    }
    for (const key of Object.keys(model.looks)) {
      const at = key.indexOf("/"), view = owner.look({ collection: key.slice(0, at), look: key.slice(at + 1) });
      looks[key] = view ? { name: view.name, parts: view.parts, state: view.state } : null;
    }
    return { collections, looks };
  }

  test("every step's command is in the window after a restart, whole or (killed before its first key write) not at all", async () => {
    let steps = 0, kills = 0, before = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rng = random(seed * 7919), documents = storeDocuments(), storage = memoryOutboxStorage();
      let w = windowOn(documents, { storage });
      await w.start();
      let model: Model = { collections: {}, looks: {} };
      let open: ReturnType<typeof w.sessions.open>[] = [];
      for (let step = 0; step < 120; step++, steps++) {
        const expected: Model = structuredClone(model);
        const ids = Object.keys(expected.collections), kill = rng.next() < 0.25;
        const writesBefore = storage.writes;
        if (kill) storage.killAfter(rng.int(3), () => w.outbox.stop());
        const roll = rng.next(), id = ids.length ? rng.pick(ids) : "", view = id ? w.owner.collection(id) : null;
        const set = (key: string, look: { name: string; parts: unknown; state: string } | null) => { expected.looks[key] = look; };
        const take = (answer: ReturnType<CollectionOwner["dispatch"]>) => answer.ok;
        try {
          if (!ids.length || roll < 0.08) {
            const answer = w.owner.dispatch({ kind: "collection.create", name: `C${step}`, looks: [{ name: `L${step}`, parts: parts(step) }] });
            if (take(answer) && answer.ok) {
              const look = w.owner.collection(answer.collection)!.looks[0]!;
              expected.collections[answer.collection] = { name: `C${step}`, looks: [look], removed: [] };
              set(`${answer.collection}/${look}`, { name: `L${step}`, parts: parts(step), state: "live" });
            }
          } else if (roll < 0.25 && view) {
            const answer = w.owner.dispatch({ kind: "collection.addLook", collection: id, base: view.revision, look: { name: `L${step}`, parts: parts(step) } });
            if (answer.ok) { expected.collections[id]!.looks.push(answer.look!.look); set(`${id}/${answer.look!.look}`, { name: `L${step}`, parts: parts(step), state: "live" }); }
          } else if (roll < 0.35 && view) {
            const sources = Object.entries(expected.looks).filter(([, look]) => look?.state === "live");
            if (sources.length) {
              const [key, look] = rng.pick(sources), at = key.indexOf("/"), from = { collection: key.slice(0, at), look: key.slice(at + 1) };
              const answer = w.owner.dispatch({ kind: "collection.copyLook", collection: id, base: view.revision, from });
              if (answer.ok) {
                const order = expected.collections[id]!.looks, place = from.collection === id ? order.indexOf(from.look) + 1 : order.length;
                order.splice(place, 0, answer.look!.look);
                set(`${id}/${answer.look!.look}`, { name: `${look!.name} (copy)`, parts: look!.parts, state: "live" });
              }
            }
          } else if (roll < 0.48 && view && view.looks.length) {
            const look = rng.pick(view.looks);
            const answer = w.owner.dispatch({ kind: "collection.removeLook", collection: id, base: view.revision, look });
            if (answer.ok) {
              const c = expected.collections[id]!;
              c.looks = c.looks.filter(item => item !== look); c.removed.push(look);
              set(`${id}/${look}`, { ...expected.looks[`${id}/${look}`]!, state: "removed" });
              while (c.removed.length > REMOVED_LIMIT) set(`${id}/${c.removed.shift()!}`, null);
            }
          } else if (roll < 0.55 && view && view.removed.length) {
            const look = rng.pick(view.removed).look;
            const answer = w.owner.dispatch({ kind: "collection.restoreLook", collection: id, base: view.revision, look });
            if (answer.ok) {
              const c = expected.collections[id]!;
              c.removed = c.removed.filter(item => item !== look); c.looks.push(look);
              set(`${id}/${look}`, { ...expected.looks[`${id}/${look}`]!, state: "live" });
            }
          } else if (roll < 0.62 && view) {
            if (w.owner.dispatch({ kind: "collection.rename", collection: id, base: view.revision, name: `R${step}` }).ok) expected.collections[id]!.name = `R${step}`;
          } else if (roll < 0.68 && view && view.looks.length > 1) {
            const order = [...view.looks].reverse();
            if (w.owner.dispatch({ kind: "collection.reorder", collection: id, base: view.revision, looks: order }).ok) expected.collections[id]!.looks = order;
          } else if (roll < 0.9) {
            // A look edited through a session (several are open at once).
            const live = Object.entries(expected.looks).filter(([, look]) => look?.state === "live");
            if (live.length) {
              const [key] = rng.pick(live), at = key.indexOf("/"), ref = { collection: key.slice(0, at), look: key.slice(at + 1) };
              let session = open.find(item => item.ref.collection === ref.collection && item.ref.look === ref.look);
              if (!session) { session = w.sessions.open(ref); open.push(session); }
              if (session.update({ parts: parts(1000 + step) }).ok) set(key, { ...expected.looks[key]!, parts: parts(1000 + step) });
            }
          } else {
            // Let the library answer for a while (acknowledgements write keys too, and a kill may land among them).
            await tick(1);
          }
        } catch (error) { if (!w.outbox.status().stopped) throw error; }
        await tick();
        storage.killAfter(Infinity);
        if (!w.outbox.status().stopped) {
          expect(shown(w.owner, expected)).toEqual(expected);
          model = expected;
          continue;
        }
        // Killed: a new window on the same storage and library.
        kills++;
        const allowed = storage.writes === writesBefore ? model : expected;
        if (allowed === model) before++;
        w = windowOn(documents, { storage });
        await w.start();
        open = [];
        expect(shown(w.owner, allowed)).toEqual(allowed);
        model = allowed;
      }
      // Everything reaches the library, and the library holds exactly the model.
      await quiet(w.outbox);
      expect(w.outbox.status()).toMatchObject({ pending: 0, conflicts: 0 });
      const fresh = windowOn(documents);
      await fresh.start();
      expect(shown(fresh.owner, model)).toEqual(model);
      w.outbox.stop(); fresh.outbox.stop();
    }
    console.log(JSON.stringify({ steps, kills, killedBeforeAnyWrite: before }));
    expect(kills).toBeGreaterThan(20);
    expect(before).toBeGreaterThan(0);
    expect(steps).toBe(12 * 120);
  });
});

describe("Save version's route", () => {
  test("the page's transport reaches the host's route; a released page's save is refused; a missing collection says so", async () => {
    const { collectionVersionsHandler } = await import("../src/library/host/collection-store");
    const { collectionVersions } = await import("../src/library/browser/collection-transport");
    const file = openTestLibrary(":memory:");
    try {
      const handle = collectionVersionsHandler(file.collections, file.documents, file.database, "/api/collection-versions");
      const send = (url: string, init?: RequestInit) => handle(new Request(`http://127.0.0.1:4317${url}`, { ...init, headers: { ...init?.headers as Record<string, string>, Origin: "http://127.0.0.1:4317" } }));
      const source = STUDIO_PARTS.readCollection(readFixture(COLLECTION_FIXTURES[0]!));
      file.documents.transact({ id: "create", command: "collection.create", writes: [
        { ...collectionRef(source.id), base: 0, value: { schema: "xfs/collection-working-1", id: source.id, name: source.name, looks: source.presets.map(p => p.id), removed: [], createdAt: 1 } },
        ...source.presets.map(preset => ({ ...lookRef({ collection: source.id, look: preset.id }), base: 0,
          value: { schema: "xfs/look-working-1", collection: source.id, id: preset.id, name: preset.name, parts: JSON.parse(JSON.stringify(preset.parts)), state: "live" } }))] });
      const generation = file.documents.nextLease("desktop");
      let fence = { workspace: "desktop", generation };
      const port = collectionVersions("/api/collection-versions", send, () => fence);
      expect(await port.save(source.id)).toMatchObject({ revision: 1 });
      expect(file.collections.get(source.id).collection.presets.length).toBe(source.presets.length);
      file.documents.nextLease("desktop");
      await expect(port.save(source.id)).rejects.toThrow("open elsewhere");
      fence = { workspace: "desktop", generation: generation + 1 };
      await expect(port.save(crypto.randomUUID())).rejects.toThrow("doesn't exist");
      expect(file.collections.list().map(item => item.revision)).toEqual([1]);
    } finally { file.close(); }
  });
});

describe("expiry between windows", () => {
  test("an expiry another window's change made stale is dropped by itself; the next load expires again", async () => {
    let now = 1_000_000_000_000;
    const documents = storeDocuments(), w = windowOn(documents, { now: () => now });
    await w.start();
    const id = expectOk(w.owner.dispatch({ kind: "collection.create", name: "Old", looks: [{ name: "a" }, { name: "b" }] })).collection;
    const [first] = w.owner.looksOf(id);
    expectOk(w.owner.dispatch({ kind: "collection.removeLook", collection: id, base: w.owner.collection(id)!.revision, look: first!.ref.look }));
    await quiet(w.outbox);
    now += REMOVED_FOR_MS + 1;
    let gate: (() => void) | null = null;
    const port: DocumentStorePort = { ...documents, async transact(request) { if (request.command === "collection.expire" && !gate) await new Promise<void>(resolve => { gate = resolve; }); return documents.store.transact(request); } };
    const later = windowOn(documents, { now: () => now, port });
    await later.start();
    await tick(2);
    // Another window renames the collection while the expiry is on its way.
    const current = documents.store.get(COLLECTION_WORKING, id)!;
    documents.store.transact({ id: "other", command: "collection.rename", writes: [{ ...collectionRef(id), base: current.revision, value: { ...current.value as object, name: "Renamed elsewhere" } }] });
    (gate as unknown as () => void)();
    await tick(5); await quiet(later.outbox);
    expect(later.owner.conflicts()).toEqual([]);
    expect(later.outbox.pendingEntries()).toEqual([]);
    await later.outbox.check(); await tick(2);
    expect(later.owner.collection(id)!.name).toBe("Renamed elsewhere");
    // Expired again on the next pass, over theirs.
    later.owner.expire();
    await quiet(later.outbox);
    const stored = documents.store.get<{ name: string; removed: unknown[] }>(COLLECTION_WORKING, id)!.value;
    expect(stored).toMatchObject({ name: "Renamed elsewhere", removed: [] });
    expect(isTombstone(documents.store.get(LOOK_WORKING, `${id}/${first!.ref.look}`)!.value)).toBe(true);
  });
});

describe("review of chunk 1c-ii: regressions", () => {
  test("finding 2: Keep mine on a stale collection makes its membership whole in one command, restoring the looks it lists", async () => {
    for (const how of ["removed", "pushed out"] as const) {
      const documents = storeDocuments(), a = windowOn(documents), b = windowOn(documents);
      await a.start();
      const id = expectOk(a.owner.dispatch({ kind: "collection.create", name: "Shared", looks: [{ name: "x", parts: parts(1) }, { name: "y", parts: parts(2) }] })).collection;
      await quiet(a.outbox);
      await b.start();
      const y = a.owner.looksOf(id)[1]!.ref;
      expectOk(b.owner.dispatch({ kind: "collection.removeLook", collection: id, base: b.owner.collection(id)!.revision, look: y.look }));
      await quiet(b.outbox);
      if (how === "pushed out") {
        // Another window's expiry: the look's tombstone, and the collection no longer names it.
        const current = documents.store.get<Record<string, unknown>>(COLLECTION_WORKING, id)!, look = documents.store.get(LOOK_WORKING, `${id}/${y.look}`)!;
        documents.store.transact({ id: "expire", command: "collection.expire", writes: [
          { ...collectionRef(id), base: current.revision, value: { ...current.value, removed: [] } },
          { kind: LOOK_WORKING, id: `${id}/${y.look}`, base: look.revision, value: tombstoneOf(look.value, 1) }] });
      }
      expectOk(a.owner.dispatch({ kind: "collection.rename", collection: id, base: a.owner.collection(id)!.revision, name: "Mine" }));
      await quiet(a.outbox);
      const [conflict] = a.owner.conflicts();
      expect(await a.owner.resolve(conflict!.id, "mine")).toEqual({ available: true });
      // One command: the collection and the look it lists, live again.
      expect(a.outbox.pendingEntries().at(-1)!.writes.map(write => write.kind)).toEqual([COLLECTION_WORKING, LOOK_WORKING]);
      await quiet(a.outbox);
      const stored = documents.store.get<{ name: string; looks: string[]; removed: unknown[] }>(COLLECTION_WORKING, id)!.value;
      expect(stored).toMatchObject({ name: "Mine", looks: [a.owner.looksOf(id)[0]!.ref.look, y.look], removed: [] });
      expect(documents.store.get<{ state: string }>(LOOK_WORKING, `${id}/${y.look}`)!.value).toMatchObject({ state: "live", name: "y" });
      const snapshot = await a.owner.snapshot(id);
      expect("looks" in snapshot && snapshot.looks.map(look => look.name)).toEqual(["x", "y"]);
    }
  });

  test("finding 2: a snapshot or a version never leaves out a listed look; cleanup never purges a look a live collection lists", async () => {
    let now = 1_000_000_000_000;
    const file = openTestLibrary(":memory:");
    (file.documents as unknown as { options: { now: () => number } }).options.now = () => now;
    try {
      const source = STUDIO_PARTS.readCollection(readFixture(COLLECTION_FIXTURES[0]!));
      const [first, second] = source.presets;
      file.documents.transact({ id: "c", command: "collection.create", writes: [
        { ...collectionRef(source.id), base: 0, value: { schema: "xfs/collection-working-1", id: source.id, name: "Broken", looks: [first!.id, second!.id], removed: [], createdAt: 1 } },
        { ...lookRef({ collection: source.id, look: first!.id }), base: 0, value: { schema: "xfs/look-working-1", collection: source.id, id: first!.id, name: "a", parts: JSON.parse(JSON.stringify(first!.parts)), state: "live" } },
        { ...lookRef({ collection: source.id, look: second!.id }), base: 0, value: tombstoneOf({ schema: "xfs/look-working-1", collection: source.id, id: second!.id, name: "b", parts: {}, state: "removed" }, now) }] });
      expect(() => saveCollectionVersion(file.collections, file.documents, file.database, source.id)).toThrow("isn't there any more");
      expect(file.collections.list()).toEqual([]);
      const documents = { store: file.documents, list: async (kind: string) => file.documents.list(kind), transact: async (request: never) => file.documents.transact(request),
        revisions: async (refs: never) => file.documents.revisions(refs), read: async (refs: never) => file.documents.read(refs) } as unknown as ReturnType<typeof storeDocuments>;
      const w = windowOn(documents);
      await w.start();
      expect(await w.owner.snapshot(source.id)).toMatchObject({ available: false, code: "invalid_value" });
      now += 40 * DAY;
      file.documents.cleanup();
      expect(file.documents.get(LOOK_WORKING, `${source.id}/${second!.id}`)).not.toBeNull();
    } finally { file.close(); }
  });

  test("finding 3: a decoded save the cleanup purged before a command naming it landed is put again from this page, then the command lands", async () => {
    const documents = storeDocuments(), store = documents.store;
    const outbox = new DocumentOutbox(documents, memoryOutboxStorage(), { retryMs: 5, immutable: kind => kind === "saved-v" });
    const blob = { kind: "saved-v", id: "s-1" }, doc = { kind: "character", id: "c-1" };
    outbox.hold(blob, null); outbox.hold(doc, null); outbox.open();
    outbox.put(blob, { save: 1 });
    await quiet(outbox);
    // The cleanup purges it (old, and nothing names it yet); this page still believes it is there.
    (store as unknown as { db: { write(change: (db: { query(sql: string): { run(...args: unknown[]): unknown } }) => void): void } }).db
      .write(db => { db.query("DELETE FROM documents WHERE kind = 'saved-v'").run(); });
    expect(store.transact({ id: "probe", command: "x", writes: [{ ...doc, base: 0, value: 1 }], requires: [blob] })).toEqual({ ok: false, reason: "missing", missing: ["saved-v/s-1"] });
    outbox.commit("character.create", [{ ...doc, value: { source: { decoded: "s-1" } } }], { requires: [blob] });
    await quiet(outbox); await tick(20); await quiet(outbox);
    expect(outbox.pendingEntries()).toEqual([]);
    expect(store.get("saved-v", "s-1")!.value).toEqual({ save: 1 });
    expect(store.get("character", "c-1")!.value).toEqual({ source: { decoded: "s-1" } });
  });

  test("finding 4: a command over the host's write limit is refused before it is recorded; the largest one allowed lands", async () => {
    const { MAX_LOOKS_AT_CREATE } = await import("../src/library/collection-owner");
    const documents = storeDocuments(), w = windowOn(documents);
    await w.start();
    const looks = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `L${i}` }));
    expect(w.owner.dispatch({ kind: "collection.create", name: "Too many", looks: looks(MAX_LOOKS_AT_CREATE + 1) })).toMatchObject({ ok: false, code: "limit" });
    expect(w.outbox.pendingEntries()).toEqual([]);
    expect(() => w.outbox.commit("x", looks(65).map((_, i) => ({ kind: "doc", id: `d${i}`, value: i })))).toThrow("too many");
    const made = expectOk(w.owner.dispatch({ kind: "collection.create", name: "Full", looks: looks(MAX_LOOKS_AT_CREATE) }));
    await quiet(w.outbox);
    expect(documents.store.list(LOOK_WORKING).length).toBe(MAX_LOOKS_AT_CREATE);
    expect(w.owner.looksOf(made.collection).length).toBe(MAX_LOOKS_AT_CREATE);
  });

  test("finding 5: Save version checks the lease inside its transaction: a lease issued while the request arrived refuses it", async () => {
    const { collectionVersionsHandler } = await import("../src/library/host/collection-store");
    const file = openTestLibrary(":memory:");
    try {
      const source = STUDIO_PARTS.readCollection(readFixture(COLLECTION_FIXTURES[0]!));
      file.documents.transact({ id: "c", command: "collection.create", writes: [
        { ...collectionRef(source.id), base: 0, value: { schema: "xfs/collection-working-1", id: source.id, name: "A", looks: [], removed: [], createdAt: 1 } }] });
      const generation = file.documents.nextLease("desktop");
      const handle = collectionVersionsHandler(file.collections, file.documents, file.database, "/api/collection-versions");
      let release!: () => void;
      const arrived = new Promise<void>(resolve => { release = resolve; });
      const body = new ReadableStream({ async pull(controller) {
        await arrived; controller.enqueue(new TextEncoder().encode(JSON.stringify({ collection: source.id }))); controller.close();
      } });
      const answer = handle(new Request("http://127.0.0.1:4317/api/collection-versions", { method: "POST", body, duplex: "half",
        headers: { Origin: "http://127.0.0.1:4317", "Content-Type": "application/json", "X-XFS-Workspace-Lease": `${generation} desktop` } } as RequestInit));
      await tick(5);
      file.documents.nextLease("desktop");   // another page takes the workspace while the body is still arriving
      release();
      const response = await answer;
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "superseded" });
      expect(file.collections.list()).toEqual([]);
    } finally { file.close(); }
  });

  test("finding 6: a snapshot's or a save's wait for the flush ends with its signal; the changes are still sent", async () => {
    const documents = storeDocuments();
    let open!: () => void;
    let hung = true;
    const port: DocumentStorePort = { ...documents, async transact(request) {
      if (hung) await new Promise<void>(resolve => { open = resolve; });
      return documents.store.transact(request);
    } };
    const w = windowOn(documents, { port, versions: { save: async () => ({ revision: 1, updatedAt: "", documents: {} }) } });
    await w.start();
    const id = expectOk(w.owner.dispatch({ kind: "collection.create", name: "Hung", looks: [{ name: "x" }] })).collection;
    const stop = new AbortController();
    const snapshot = w.owner.snapshot(id, stop.signal), saved = w.owner.saveVersion(id, stop.signal);
    await tick(5);
    stop.abort();
    expect(await snapshot).toMatchObject({ available: false, code: "not_ready" });
    expect(await saved).toMatchObject({ ok: false, code: "not_ready" });
    hung = false; open();
    await quiet(w.outbox);
    expect(documents.store.get(COLLECTION_WORKING, id)).not.toBeNull();
  });

  test("finding 7: a session whose last release couldn't wait for the library closes once its changes arrive", async () => {
    const documents = storeDocuments();
    let down = false;
    const port: DocumentStorePort = { ...documents, async transact(request) { if (down) throw Error("The host didn't answer."); return documents.store.transact(request); } };
    const w = windowOn(documents, { port });
    await w.start();
    const id = expectOk(w.owner.dispatch({ kind: "collection.create", name: "C", looks: [{ name: "x" }] })).collection;
    await quiet(w.outbox);
    const session = w.sessions.open(w.owner.looksOf(id)[0]!.ref);
    down = true;
    session.update({ name: "y" });
    expect(await session.release()).toBe(false);
    expect(w.sessions.held().length).toBe(1);
    down = false;
    await tick(30); await quiet(w.outbox);
    expect(w.sessions.held()).toEqual([]);
    expect(documents.store.get<{ name: string }>(LOOK_WORKING, `${id}/${w.owner.looksOf(id)[0]!.ref.look}`)!.value.name).toBe("y");
  });
});

describe("second review of chunk 1c-ii: regressions", () => {
  const purge = (store: ReturnType<typeof storeDocuments>["store"], kind: string, id: string) =>
    (store as unknown as { db: { write(change: (db: { query(sql: string): { run(...args: unknown[]): unknown } }) => void): void } }).db
      .write(db => { db.query("DELETE FROM documents WHERE kind = ? AND id = ?").run(kind, id); });

  test("finding 2: Keep mine reads the looks it lists from the library: a purged one is written back from this page's copy, in the same command", async () => {
    const documents = storeDocuments(), a = windowOn(documents), b = windowOn(documents);
    await a.start();
    const id = expectOk(a.owner.dispatch({ kind: "collection.create", name: "Shared", looks: [{ name: "x", parts: parts(1) }, { name: "y", parts: parts(2) }] })).collection;
    await quiet(a.outbox);
    await b.start();
    const y = a.owner.looksOf(id)[1]!.ref;
    expectOk(b.owner.dispatch({ kind: "collection.removeLook", collection: id, base: b.owner.collection(id)!.revision, look: y.look }));
    await quiet(b.outbox);
    // Expired and purged elsewhere: nothing of y is left in the library. This window still holds y as it last saw it (live).
    const current = documents.store.get<Record<string, unknown>>(COLLECTION_WORKING, id)!;
    documents.store.transact({ id: "expire", command: "collection.expire", writes: [{ ...collectionRef(id), base: current.revision, value: { ...current.value, removed: [] } }] });
    purge(documents.store, LOOK_WORKING, `${id}/${y.look}`);
    expectOk(a.owner.dispatch({ kind: "collection.rename", collection: id, base: a.owner.collection(id)!.revision, name: "Mine" }));
    await quiet(a.outbox);
    expect(await a.owner.resolve(a.owner.conflicts()[0]!.id, "mine")).toEqual({ available: true });
    await quiet(a.outbox);
    expect(a.owner.conflicts()).toEqual([]);
    expect(documents.store.get<{ looks: string[] }>(COLLECTION_WORKING, id)!.value.looks).toContain(y.look);
    expect(documents.store.get<{ state: string; name: string }>(LOOK_WORKING, `${id}/${y.look}`)!.value).toMatchObject({ state: "live", name: "y" });
    const snapshot = await a.owner.snapshot(id);
    expect("looks" in snapshot && snapshot.looks.map(look => look.name)).toEqual(["x", "y"]);
  });

  test("finding 2: a listed look nothing is left of anywhere refuses Keep mine before anything is written", async () => {
    const documents = storeDocuments(), a = windowOn(documents), b = windowOn(documents);
    await a.start();
    const id = expectOk(a.owner.dispatch({ kind: "collection.create", name: "Shared", looks: [{ name: "x" }] })).collection;
    await quiet(a.outbox);
    await b.start();
    // Another window adds z; this window never reads it; then z is purged.
    const z = expectOk(b.owner.dispatch({ kind: "collection.addLook", collection: id, base: b.owner.collection(id)!.revision, look: { name: "z" } })).look!;
    await quiet(b.outbox);
    purge(documents.store, LOOK_WORKING, `${id}/${z.look}`);
    expectOk(a.owner.dispatch({ kind: "collection.rename", collection: id, base: a.owner.collection(id)!.revision, name: "Mine" }));
    await quiet(a.outbox);
    const [conflict] = a.owner.conflicts();
    const before = documents.store.get(COLLECTION_WORKING, id)!.revision;
    expect(await a.owner.resolve(conflict!.id, "mine")).toMatchObject({ available: false, reason: expect.stringContaining("deleted for good") });
    await quiet(a.outbox);
    expect(a.owner.conflicts().map(entry => entry.id)).toEqual([conflict!.id]);
    expect(documents.store.get(COLLECTION_WORKING, id)!.revision).toBe(before);
    expect(await a.owner.resolve(conflict!.id, "theirs")).toEqual({ available: true });
  });
});

describe("second review of chunk 1c-ii: recovery's sources and availability", () => {
  const blob = { kind: "saved-v", id: "s-1" }, doc = { kind: "character", id: "c-1" };
  const purgeSaves = (store: ReturnType<typeof storeDocuments>["store"]) =>
    (store as unknown as { db: { write(change: (db: { query(sql: string): { run(...args: unknown[]): unknown } }) => void): void } }).db
      .write(db => { db.query("DELETE FROM documents WHERE kind = 'saved-v'").run(); });
  /** A port whose commands wait while `held` says so. */
  const gated = (documents: ReturnType<typeof storeDocuments>) => {
    let held = false; const waits: (() => void)[] = [];
    const port: DocumentStorePort = { ...documents, async transact(request) { if (held) await new Promise<void>(resolve => waits.push(resolve)); return documents.store.transact(request); } };
    return { port, hold() { held = true; }, open() { held = false; for (const resume of waits.splice(0)) resume(); } };
  };
  const immutable = (kind: string) => kind === "saved-v";

  test("finding 3: a save the cleanup purged while a command naming it was stored is put again after a restart from the copy kept with that command", async () => {
    const documents = storeDocuments(), gate = gated(documents), storage = memoryOutboxStorage();
    const first = new DocumentOutbox(gate.port, storage, { retryMs: 5, immutable });
    first.hold(blob, null); first.hold(doc, null); first.open();
    first.put(blob, { save: 1 });
    await quiet(first);
    gate.hold();
    first.commit("character.create", [{ ...doc, value: { decoded: "s-1" } }], { requires: [blob] });
    await tick();
    first.stop();
    // The save's own key keeps its content while the command needs it.
    expect(JSON.parse(storage.keys.get("saved-v/s-1")!).retained).toEqual({ save: 1 });
    purgeSaves(documents.store);
    gate.open();
    // A restart that never read the save: it isn't in the library any more, and this page holds no other copy.
    const second = new DocumentOutbox(gate.port, storage, { retryMs: 5, immutable });
    second.hold(doc, null); second.open();
    for (let i = 0; i < 50 && second.pendingEntries().length; i++) await tick(5);
    expect(second.pendingEntries()).toEqual([]);
    expect(documents.store.get("saved-v", "s-1")!.value).toEqual({ save: 1 });
    expect(documents.store.get("character", "c-1")!.value).toEqual({ decoded: "s-1" });
    // Nothing requires it any more: its key is let go.
    expect(storage.keys.has("saved-v/s-1")).toBe(false);
  });

  test("finding 3: with no copy anywhere, the waiting change says so (missing), and can be discarded, or sent once the save is imported again", async () => {
    for (const way of ["discard", "import"] as const) {
      const documents = storeDocuments(), gate = gated(documents), storage = memoryOutboxStorage();
      const first = new DocumentOutbox(gate.port, storage, { retryMs: 5, immutable });
      first.hold(blob, null); first.hold(doc, null); first.open();
      first.put(blob, { save: 1 });
      await quiet(first);
      gate.hold();
      first.commit("character.create", [{ ...doc, value: { decoded: "s-1" } }], { requires: [blob] });
      await tick();
      first.stop();
      // Not even the kept copy is left (an earlier build's record, or lost).
      storage.keys.delete("saved-v/s-1");
      purgeSaves(documents.store);
      gate.open();
      const second = new DocumentOutbox(gate.port, storage, { retryMs: 5, immutable });
      second.hold(doc, null); second.open();
      for (let i = 0; i < 20 && !second.status().missing.length; i++) await tick(5);
      expect(second.status().missing).toEqual([doc]);
      expect(second.recovering(doc)).toBe(true);
      if (way === "discard") {
        expect(second.discardWaiting()).toBe(1);
        expect(second.status()).toMatchObject({ missing: [], recovering: [] });
        second.commit("character.create", [{ ...doc, value: { decoded: "other" } }]);
        await quiet(second);
        expect(documents.store.get("character", "c-1")!.value).toEqual({ decoded: "other" });
      } else {
        second.put(blob, { save: 1 });
        for (let i = 0; i < 50 && second.pendingEntries().length; i++) await tick(5);
        expect(second.status().missing).toEqual([]);
        expect(documents.store.get("character", "c-1")!.value).toEqual({ decoded: "s-1" });
      }
      second.stop();
    }
  });

  test("availability: restoring says so, offers a way on after 5 s, and Keep working unlocks only a document whose restored change the library hadn't taken", async () => {
    const { RECOVERY_NOTICE_MS } = await import("../src/platform/core/document-outbox");
    for (const committed of [false, true]) {
      let now = 1_000;
      const documents = storeDocuments(), gate = gated(documents), storage = memoryOutboxStorage(), timers: (() => void)[] = [];
      // The notice's timers are the test's to run; retries and attempt deadlines run on the real clock.
      const options = { retryMs: 5, now: () => now, schedule: (ms: number, run: () => void) => {
        if (ms === RECOVERY_NOTICE_MS || ms === 1000) { timers.push(run); return { cancel() {} }; }
        const timer = setTimeout(run, ms); return { cancel: () => clearTimeout(timer) };
      } };
      const first = new DocumentOutbox(gate.port, storage, options);
      first.hold(DOC, null); first.open();
      if (committed) { first.commit("look.update", [{ ...DOC, value: { n: 0 } }]); await quiet(first); }
      gate.hold();
      first.commit("look.update", [{ ...DOC, value: { n: 1 } }]);
      await tick();
      const stored = new Map(storage.keys);
      if (committed) { gate.open(); await quiet(first); }   // it reached the library, but the record of that didn't
      first.stop();
      storage.keys.clear(); for (const [key, text] of stored) storage.keys.set(key, text);
      gate.hold();
      const second = new DocumentOutbox(gate.port, storage, options);
      second.hold(DOC, documents.store.read([DOC])[documentKey(DOC)]!); second.open();
      expect(second.status()).toMatchObject({ recovering: [DOC], recoveringLong: false });
      now += RECOVERY_NOTICE_MS;
      let heard = 0; second.subscribe(event => { if (event.kind === "status") heard++; });
      for (const run of timers.splice(0)) run();
      expect(heard).toBeGreaterThan(0);
      expect(second.status()).toMatchObject({ recoveringLong: true, recoveringSafe: !committed });
      const left = second.keepRestored();
      if (!committed) {
        expect(left).toEqual([]);
        second.commit("look.update", [{ ...DOC, value: { n: 2 } }]);
        gate.open(); await quiet(second);
        expect(documents.store.get(DOC.kind, DOC.id)).toMatchObject({ value: { n: 2 } });
      } else {
        // The library had taken it: keeping on would risk writing over a newer value, so it stays locked until the answer comes.
        expect(left).toEqual([DOC]);
        expect(() => second.commit("look.update", [{ ...DOC, value: { n: 2 } }])).toThrow(OutboxRecoveringError);
        gate.open(); second.retry(); await quiet(second);
        expect(second.status().recovering).toEqual([]);
      }
      second.stop();
    }
  });
});

describe("third review of chunk 1c-ii: a hung request", () => {
  test("finding 3: Try again abandons a hung attempt and sends the command again under its ID; the late answer changes nothing; the gate holds until then", async () => {
    const documents = storeDocuments(), storage = memoryOutboxStorage();
    // A command stored by an earlier page, never answered.
    const hang = new DocumentOutbox({ ...documents, transact: () => new Promise<TransactAnswer>(() => {}) }, storage, { retryMs: 5 });
    hang.hold(DOC, null); hang.open();
    const entry = hang.commit("look.update", [{ ...DOC, value: { n: 1 } }]);
    hang.stop();
    // The next page's first attempt hangs (the host never answers it); later ones are answered.
    const calls: { id: string; signal?: AbortSignal }[] = [];
    let late: ((answer: TransactAnswer) => void) | null = null;
    const port: DocumentStorePort = { ...documents, transact: (request, signal) => {
      calls.push({ id: request.id, signal });
      if (calls.length === 1) return new Promise<TransactAnswer>(resolve => { late = resolve; });
      return Promise.resolve(documents.store.transact(request));
    } };
    const second = new DocumentOutbox(port, storage, { retryMs: 5 });
    second.hold(DOC, null); second.open();
    await tick(5);
    expect(calls.length).toBe(1);
    expect(second.recovering(DOC)).toBe(true);
    // Waiting changes nothing, and the gate holds (no timer unlocks it).
    await tick(20);
    expect(calls.length).toBe(1);
    expect(() => second.commit("look.update", [{ ...DOC, value: { n: 2 } }])).toThrow(OutboxRecoveringError);
    second.retry();
    await quiet(second);
    expect(calls.map(call => call.id)).toEqual([entry.id, entry.id]);
    expect(calls[0]!.signal!.aborted).toBe(true);
    expect(second.recovering(DOC)).toBe(false);
    expect(documents.store.get(DOC.kind, DOC.id)).toMatchObject({ revision: 1, value: { n: 1 } });
    // The abandoned attempt's answer finally arrives: it is ignored (the command is already acknowledged), nothing is applied twice.
    (late as unknown as (answer: TransactAnswer) => void)({ ok: true, revisions: { [documentKey(DOC)]: 7 } });
    await tick(5);
    expect(second.document(DOC)).toMatchObject({ revision: 1, value: { n: 1 }, pending: false });
    second.commit("look.update", [{ ...DOC, value: { n: 2 } }]);
    await quiet(second);
    expect(documents.store.get(DOC.kind, DOC.id)).toMatchObject({ revision: 2, value: { n: 2 } });
    second.stop();
  });

  test("finding 3: an attempt past its deadline is abandoned and sent again by itself", async () => {
    const documents = storeDocuments();
    let calls = 0;
    const port: DocumentStorePort = { ...documents, transact: request => {
      calls++;
      return calls === 1 ? new Promise<TransactAnswer>(() => {}) : Promise.resolve(documents.store.transact(request));
    } };
    const outbox = new DocumentOutbox(port, memoryOutboxStorage(), { retryMs: 5, attemptMs: 20 });
    outbox.hold(DOC, null); outbox.open();
    outbox.commit("look.update", [{ ...DOC, value: { n: 1 } }]);
    for (let i = 0; i < 50 && outbox.status().pending; i++) await tick(5);
    expect(calls).toBe(2);
    expect(documents.store.get(DOC.kind, DOC.id)).toMatchObject({ value: { n: 1 } });
    outbox.stop();
  });
});

describe("third review of chunk 1c-ii: found by the extended specification test", () => {
  test("a replay of a stored copy older than the command as sent takes what the library committed, never the copy's older value", async () => {
    const documents = storeDocuments(), storage = memoryOutboxStorage();
    let held = true; const waits: (() => void)[] = [];
    const port: DocumentStorePort = { ...documents, async transact(request) { if (held) await new Promise<void>(resolve => waits.push(resolve)); return documents.store.transact({ ...request, forget: [] }); } };
    const first = new DocumentOutbox(port, storage, { retryMs: 5 });
    first.hold(DOC, null); first.open();
    first.commit("look.update", [{ ...DOC, value: { n: 12 } }]);
    const older = new Map(storage.keys);   // the copy a crash keeps: the command before its last edit joined it
    first.commit("look.update", [{ ...DOC, value: { n: 13 } }]);
    held = false; for (const resume of waits.splice(0)) resume();
    await quiet(first);
    expect(documents.store.get(DOC.kind, DOC.id)!.value).toEqual({ n: 13 });
    first.stop();
    storage.keys.clear(); for (const [key, text] of older) storage.keys.set(key, text);
    const second = new DocumentOutbox(port, storage, { retryMs: 5 });
    second.hold(DOC, null); second.open();
    await quiet(second);
    expect(second.document(DOC)).toMatchObject({ revision: 1, value: { n: 13 }, pending: false });
    second.stop();
  });
});
