/**
 * The outbox (profiles design §2.2, rules A1–A7) and idempotent `transact` with receipts (§2.1), against the real library owner in
 * memory. Ported from spike S1's rule tests (`experiments/038-profiles-spikes/tests/s1-rules.test.ts`) onto the production code, with the
 * per-document keys, their crash repair, the revision checks and the desktop storage added.
 */
import { describe, expect, test } from "bun:test";
import { DocumentOutbox, type OutboxEvent } from "../src/platform/core/document-outbox";
import { documentKey, isTombstone, type TransactAnswer, type TransactRequest, tombstoneOf } from "../src/platform/api/document-commands";
import type { DocumentStorePort } from "../src/platform/api/document-store";
import { desktopOutboxStorage, localOutboxStorage } from "../src/app/browser/outbox-storage";
import { sha256Hex } from "../src/platform/core/sha256";
import { memoryOutbox, memoryOutboxStorage, storeDocuments } from "./fixtures/platform-doubles";

const LOOK = { kind: "look-working", id: "c-1/l-1" };
const COLLECTION = { kind: "collection-working", id: "c-1" };
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

/** The library behind a port whose answers a test can hold, or lose after the commit. */
function rig() {
  const documents = storeDocuments();
  const calls: TransactRequest[] = [];
  let lose = 0, down = false, hold: Promise<void> | null = null;
  const port: DocumentStorePort = { ...documents,
    async transact(request): Promise<TransactAnswer> {
      calls.push(structuredClone(request));
      if (hold) await hold;
      if (down) throw Error("The host didn't answer.");
      const answer = documents.store.transact(request);
      if (lose > 0) { lose--; throw Error("The answer was lost."); }
      return answer;
    } };
  return { documents, store: documents.store, port, calls, loseAnswers(n: number) { lose = n; }, setDown(value: boolean) { down = value; },
    gate() { let open!: () => void; hold = new Promise(resolve => { open = resolve; }); return () => { hold = null; open(); }; } };
}
const value = (store: ReturnType<typeof storeDocuments>["store"], ref = LOOK) => store.get(ref.kind, ref.id);
async function quiet(outbox: DocumentOutbox) { for (let i = 0; i < 100 && outbox.status().pending; i++) await tick(5); }
function events(outbox: DocumentOutbox) { const seen: OutboxEvent[] = []; outbox.subscribe(event => { if (event.kind !== "status") seen.push(event); }); return seen; }

describe("transact: one transaction, idempotent by command ID (§2.1)", () => {
  test("a command is all or nothing across its documents, and a stale one answers what the documents hold now", () => {
    const { store } = storeDocuments();
    expect(store.transact({ id: "a", command: "x", writes: [{ ...LOOK, base: 0, value: { n: 1 } }, { ...COLLECTION, base: 0, value: { c: 1 } }] }))
      .toEqual({ ok: true, revisions: { "look-working/c-1/l-1": 1, "collection-working/c-1": 1 } });
    // One stale base: nothing is written, not even the write whose base matched.
    expect(store.transact({ id: "b", command: "x", writes: [{ ...LOOK, base: 1, value: { n: 2 } }, { ...COLLECTION, base: 0, value: { c: 2 } }] }))
      .toEqual({ ok: false, reason: "stale", current: { "look-working/c-1/l-1": { revision: 1, value: { n: 1 } }, "collection-working/c-1": { revision: 1, value: { c: 1 } } } });
    expect(store.get(LOOK.kind, LOOK.id)!.value).toEqual({ n: 1 });
    expect(store.get("xfs-receipt", "b")).toBeNull();
  });

  test("a replay is answered from its receipt; forget deletes receipts; the equal-value rule acknowledges a purged one", () => {
    const { store } = storeDocuments();
    const request = { id: "a", command: "x", writes: [{ ...LOOK, base: 0, value: { n: 1 } }] };
    expect(store.transact(request)).toEqual({ ok: true, revisions: { [documentKey(LOOK)]: 1 } });
    expect(store.transact(request)).toEqual({ ok: true, revisions: { [documentKey(LOOK)]: 1 }, replayed: "receipt" });
    expect(store.get(LOOK.kind, LOOK.id)!.revision).toBe(1);
    // A later command forgets it: the replay is now answered by the equal-value rule while the value is still exactly the replayed one.
    store.transact({ id: "b", command: "y", writes: [{ ...COLLECTION, base: 0, value: 1 }], forget: ["a"] });
    expect(store.get("xfs-receipt", "a")).toBeNull();
    expect(store.transact(request)).toEqual({ ok: true, revisions: { [documentKey(LOOK)]: 1 }, replayed: "equal" });
    // Once the document moved on, the same replay is stale: nothing is written over the newer value.
    store.transact({ id: "c", command: "x", writes: [{ ...LOOK, base: 1, value: { n: 2 } }] });
    expect(store.transact({ ...request, id: "a2" })).toMatchObject({ ok: false, reason: "stale" });
    // Tombstones compare whole (their time is part of the value written).
    const gone = tombstoneOf({ n: 2 }, 5);
    expect(store.transact({ id: "d", command: "x", writes: [{ ...LOOK, base: 2, value: gone }] })).toMatchObject({ ok: true });
    expect(store.transact({ id: "d2", command: "x", writes: [{ ...LOOK, base: 2, value: gone }] })).toMatchObject({ ok: true, replayed: "equal" });
    expect(isTombstone(store.get(LOOK.kind, LOOK.id)!.value)).toBe(true);
  });

  test("receipts are purged after 7 days at host start; host kinds and malformed commands are refused; the fence refuses old leases", () => {
    let now = 1_000_000_000_000;
    const { store } = storeDocuments();
    (store as unknown as { options: { now: () => number } }).options.now = () => now;
    store.transact({ id: "old", command: "x", writes: [{ ...LOOK, base: 0, value: 1 }] });
    now += 8 * 24 * 3600_000;
    store.transact({ id: "new", command: "x", writes: [{ ...LOOK, base: 1, value: 2 }] });
    expect(store.purgeReceipts()).toBe(1);
    expect(store.get("xfs-receipt", "old")).toBeNull();
    expect(store.get("xfs-receipt", "new")).not.toBeNull();
    expect(() => store.transact({ id: "h", command: "x", writes: [{ kind: "xfs-receipt", id: "new", base: 1, value: {} }] })).toThrow("library's own");
    expect(() => store.transact({ id: "h", command: "x", writes: [] })).toThrow("1 to 64");
    expect(() => store.transact({ id: "h", command: "x", writes: [{ ...LOOK, base: 2, value: 1 }, { ...LOOK, base: 2, value: 2 }] })).toThrow("once");
    const generation = store.nextLease("w-1");
    store.nextLease("w-1");
    expect(store.transact({ id: "f", command: "x", writes: [{ ...LOOK, base: 2, value: 3 }] }, { workspace: "w-1", generation })).toEqual({ ok: false, reason: "superseded" });
    expect(store.revisions([LOOK, COLLECTION])).toEqual({ [documentKey(LOOK)]: 2, [documentKey(COLLECTION)]: 0 });
    expect(store.read([LOOK])).toEqual({ [documentKey(LOOK)]: { revision: 2, value: 2 } });
  });
});

describe("the outbox's rules (A1–A7)", () => {
  test("a committed command whose answer was lost is resent under its ID and acknowledged as this window's own (receipt)", async () => {
    const r = rig(), { outbox } = memoryOutbox(r.port);
    const seen = events(outbox);
    r.loseAnswers(1);
    outbox.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
    await quiet(outbox);
    expect(seen.map(event => event.kind)).toEqual(["acknowledged"]);
    expect(seen[0]).toMatchObject({ replayed: "receipt" });
    expect(r.calls.map(call => call.id)).toEqual([r.calls[0]!.id, r.calls[0]!.id]);
    expect(value(r.store)).toMatchObject({ revision: 1, value: { n: 1 } });
    expect(outbox.document(LOOK)).toMatchObject({ revision: 1, value: { n: 1 }, pending: false });
  });

  test("the same after a renderer restart, with a successor coalesced behind the lost command", async () => {
    const r = rig(), storage = memoryOutboxStorage();
    const first = memoryOutbox(r.port, storage).outbox;
    const open = r.gate();
    r.loseAnswers(1);
    first.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
    await tick();
    first.commit("look.edit", [{ ...LOOK, value: { n: 2 } }]);
    first.commit("look.edit", [{ ...LOOK, value: { n: 3 } }]);
    // One frozen entry in flight and one successor holding the newest value, based after it (A1, A2).
    const entries = first.pendingEntries();
    expect(entries.length).toBe(2);
    expect(entries[1]!.writes[0]).toMatchObject({ base: { after: entries[0]!.id }, value: { n: 3 } });
    open();
    await tick(1);
    first.stop(); // The renderer dies with the answer lost.
    expect(value(r.store)!.revision).toBe(1);
    const second = new DocumentOutbox(r.port, storage, { retryMs: 5 });
    const seen = events(second);
    second.hold(LOOK, r.store.read([LOOK])[documentKey(LOOK)]!);
    second.open();
    await quiet(second);
    expect(seen.map(event => event.kind === "acknowledged" ? event.replayed ?? "fresh" : event.kind)).toEqual(["receipt", "fresh"]);
    expect(value(r.store)).toMatchObject({ revision: 2, value: { n: 3 } });
    expect(storage.keys.size).toBe(0);
  });

  test("a replay whose receipt was purged is acknowledged when the stored value is exactly the replayed one", async () => {
    const r = rig(), storage = memoryOutboxStorage();
    const first = memoryOutbox(r.port, storage, { retryMs: 1000 }).outbox;
    r.loseAnswers(1);
    first.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
    await tick(5);
    first.stop();
    expect(r.store.purgeReceipts(-1)).toBe(1);
    const second = new DocumentOutbox(r.port, storage, { retryMs: 5 });
    const seen = events(second);
    second.open();
    await quiet(second);
    expect(seen).toMatchObject([{ kind: "acknowledged", replayed: "equal" }]);
    expect(second.conflicts()).toEqual([]);
  });

  test("edits during an in-flight command coalesce into one successor, rebased onto the acknowledged revision; forget follows", async () => {
    const r = rig(), { outbox } = memoryOutbox(r.port);
    const open = r.gate();
    outbox.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
    await tick();
    for (let n = 2; n <= 10; n++) outbox.commit("look.edit", [{ ...LOOK, value: { n } }]);
    expect(outbox.pendingEntries().map(entry => entry.writes[0]!.value)).toEqual([{ n: 1 }, { n: 10 }]);
    open();
    await quiet(outbox);
    expect(r.calls.map(call => call.writes[0]!.base)).toEqual([0, 1]);
    expect(value(r.store)).toMatchObject({ revision: 2, value: { n: 10 } });
    expect(r.calls[1]!.forget).toEqual([r.calls[0]!.id]);
  });

  test("another writer's revision makes a conflict that keeps mine, folds the successor and never retries; Keep both forks mine", async () => {
    const r = rig();
    r.store.transact({ id: "other-1", command: "look.edit", writes: [{ ...LOOK, base: 0, value: { theirs: 1 } }] });
    const { outbox } = memoryOutbox(r.port);
    outbox.hold(LOOK, null); // Read before the other writer.
    const open = r.gate();
    outbox.commit("look.edit", [{ ...LOOK, value: { mine: 1 } }]);
    await tick();
    outbox.commit("look.edit", [{ ...LOOK, value: { mine: 2 } }]);
    open();
    await quiet(outbox); await tick(20);
    expect(r.calls.length).toBe(1);
    expect(outbox.conflicts().length).toBe(1);
    expect(outbox.conflicts()[0]!.writes[0]!.value).toEqual({ mine: 2 });
    expect(outbox.conflicts()[0]!.current).toEqual({ [documentKey(LOOK)]: { revision: 1, value: { theirs: 1 } } });
    expect(outbox.pendingEntries().length).toBe(1);
    // An edit while in conflict updates mine.
    outbox.commit("look.edit", [{ ...LOOK, value: { mine: 3 } }]);
    expect(outbox.pendingEntries().length).toBe(1);
    outbox.keepBoth(outbox.conflicts()[0]!.id, mine => mine.map(edit => ({ ...edit, id: `${edit.id}~fork` })));
    await quiet(outbox);
    expect(value(r.store)).toMatchObject({ revision: 1, value: { theirs: 1 } });
    expect(value(r.store, { ...LOOK, id: "c-1/l-1~fork" })).toMatchObject({ revision: 1, value: { mine: 3 } });
    expect(outbox.document(LOOK)).toMatchObject({ value: { theirs: 1 }, revision: 1, pending: false });
  });

  test("Keep mine is an explicit command over the newer revision; Use theirs takes theirs and sends nothing", async () => {
    const r = rig();
    r.store.transact({ id: "other-1", command: "look.edit", writes: [{ ...LOOK, base: 0, value: { theirs: 1 } }] });
    const { outbox } = memoryOutbox(r.port);
    outbox.commit("look.edit", [{ ...LOOK, value: { mine: 1 } }]);
    await quiet(outbox); await tick(10);
    outbox.keepMine(outbox.conflicts()[0]!.id);
    await quiet(outbox);
    expect(value(r.store)).toMatchObject({ revision: 2, value: { mine: 1 } });
    r.store.transact({ id: "other-2", command: "look.edit", writes: [{ ...LOOK, base: 2, value: { theirs: 2 } }] });
    outbox.commit("look.edit", [{ ...LOOK, value: { mine: 2 } }]);
    await quiet(outbox); await tick(10);
    const sent = r.calls.length;
    outbox.useTheirs(outbox.conflicts()[0]!.id);
    await tick(10);
    expect(r.calls.length).toBe(sent);
    expect(outbox.document(LOOK)).toMatchObject({ revision: 3, value: { theirs: 2 }, pending: false });
  });

  test("Use theirs on a multi-document conflict rebases its successors onto the stale base: they go stale in turn, never over theirs", async () => {
    const r = rig();
    r.store.transact({ id: "other", command: "x", writes: [{ ...COLLECTION, base: 0, value: { theirs: true } }] });
    const { outbox } = memoryOutbox(r.port);
    outbox.commit("collection.removeLook", [{ ...COLLECTION, value: { removed: ["l-1"] } }, { ...LOOK, value: { state: "removed" } }]);
    outbox.commit("look.edit", [{ ...LOOK, value: { n: 2 } }]);
    await tick(20);
    expect(outbox.conflicts().length).toBe(1);
    // The look's successor is blocked behind the multi-document conflict.
    expect(r.calls.length).toBe(1);
    outbox.useTheirs(outbox.conflicts()[0]!.id);
    await tick(20);
    expect(r.calls.length).toBe(2);
    expect(r.calls[1]!.writes[0]).toMatchObject({ base: 0 });
    // Its base was the dropped command's: the look had been written by nobody, so it lands (nothing of theirs is overwritten).
    expect(value(r.store)).toMatchObject({ revision: 1, value: { n: 2 } });
    expect(value(r.store, COLLECTION)).toMatchObject({ value: { theirs: true } });
  });

  test("a failed outbox write shows the warning, never blocks the edit, is still sent, and clears on the key's next good write", async () => {
    const r = rig(), storage = memoryOutboxStorage();
    const { outbox } = memoryOutbox(r.port, storage);
    storage.fail = true;
    outbox.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
    expect(outbox.status().unprotected).toEqual([LOOK]);
    expect(outbox.document(LOOK)!.value).toEqual({ n: 1 });
    await quiet(outbox);
    expect(value(r.store)).toMatchObject({ revision: 1, value: { n: 1 } });
    // The acknowledgement's write failed too: still unprotected until a write of the key lands.
    expect(outbox.status().unprotected.length).toBe(1);
    storage.fail = false;
    expect(outbox.protect()).toBe(true);
    expect(outbox.status().unprotected).toEqual([]);
  });

  test("a multi-document command waits behind each document's in-flight command and is never coalesced", async () => {
    const r = rig(), { outbox } = memoryOutbox(r.port);
    const open = r.gate();
    outbox.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
    await tick();
    outbox.commit("collection.removeLook", [{ ...COLLECTION, value: { removed: ["l-1"] } }, { ...LOOK, value: { n: 1, state: "removed" } }]);
    outbox.commit("look.edit", [{ ...LOOK, value: { n: 2 } }]);
    expect(outbox.pendingEntries().length).toBe(3);
    open();
    await quiet(outbox);
    expect(r.calls.map(call => call.command)).toEqual(["look.edit", "collection.removeLook", "look.edit"]);
    expect(value(r.store)).toMatchObject({ revision: 3, value: { n: 2 } });
    expect(value(r.store, COLLECTION)!.revision).toBe(1);
  });

  test("stored conflicts are raised again when the outbox opens, and a resolution survives a restart", async () => {
    const r = rig(), storage = memoryOutboxStorage();
    r.store.transact({ id: "other", command: "x", writes: [{ ...LOOK, base: 0, value: { theirs: 1 } }] });
    const first = memoryOutbox(r.port, storage).outbox;
    first.commit("look.edit", [{ ...LOOK, value: { mine: 1 } }]);
    await tick(20);
    first.stop();
    const second = new DocumentOutbox(r.port, storage, { retryMs: 5 });
    const seen = events(second);
    second.open();
    expect(seen.map(event => event.kind)).toEqual(["conflict"]);
    expect(second.document(LOOK)).toMatchObject({ value: { mine: 1 }, conflict: { state: "conflict" } });
  });

  test("A7: a check takes a newer revision of a clean document only, and skips documents with entries", async () => {
    const r = rig(), { outbox } = memoryOutbox(r.port);
    outbox.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
    outbox.hold(COLLECTION, null);
    await quiet(outbox);
    expect(await outbox.check()).toEqual([]);
    r.store.transact({ id: "o1", command: "x", writes: [{ ...LOOK, base: 1, value: { other: 1 } }] });
    r.store.transact({ id: "o2", command: "x", writes: [{ ...COLLECTION, base: 0, value: { other: 1 } }] });
    const open = r.gate();
    outbox.commit("look.edit", [{ ...LOOK, value: { n: 2 } }]); // Held in flight: the look has an entry.
    expect(await outbox.check()).toEqual([COLLECTION]);
    expect(outbox.document(COLLECTION)).toMatchObject({ revision: 1, value: { other: 1 } });
    expect(outbox.document(LOOK)!.value).toEqual({ n: 2 });
    open();
    await quiet(outbox); await tick(10);
    expect(outbox.conflicts().length).toBe(1);
  });

  test("settle waits for queued entries, says false when a send fails meanwhile, and the host's return triggers a check", async () => {
    const r = rig(), { outbox } = memoryOutbox(r.port);
    outbox.hold(COLLECTION, null);
    r.setDown(true);
    outbox.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
    expect(await outbox.settle()).toBe(false);
    expect(outbox.status()).toMatchObject({ failing: true, pending: 1 });
    r.store.transact({ id: "o", command: "x", writes: [{ ...COLLECTION, base: 0, value: { other: 1 } }] });
    r.setDown(false);
    expect(await outbox.settle()).toBe(true);
    await tick(10);
    expect(outbox.document(COLLECTION)).toMatchObject({ revision: 1 });
    expect(outbox.status()).toMatchObject({ failing: false, pending: 0 });
  });
});

describe("per-document keys and their crash repair", () => {
  test("each document has its own key; a commit rewrites only its own; the outbox counts its stored size", () => {
    const r = rig(), storage = memoryOutboxStorage();
    const { outbox } = memoryOutbox(r.port, storage, { writable: () => true, sendable: () => false });
    outbox.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
    outbox.commit("collection.edit", [{ ...COLLECTION, value: { c: 1 } }]);
    expect([...storage.keys.keys()].sort()).toEqual([documentKey(COLLECTION), documentKey(LOOK)]);
    const before = storage.writes;
    outbox.commit("look.edit", [{ ...LOOK, value: { n: 2 } }]);
    expect(storage.writes).toBe(before + 1);
    expect(outbox.storedSize()).toBe([...storage.keys].reduce((sum, [key, text]) => sum + key.length + text.length, 0));
  });

  test("a kill between Keep both's key writes keeps mine and never brings the conflict back", async () => {
    const r = rig(), storage = memoryOutboxStorage();
    r.store.transact({ id: "other", command: "x", writes: [{ ...LOOK, base: 0, value: { theirs: 1 } }] });
    const first = memoryOutbox(r.port, storage).outbox;
    first.commit("look.edit", [{ ...LOOK, value: { mine: 1 } }]);
    await tick(20);
    // The copy's key lands, then the window dies before the original's key is written.
    storage.killAfter(1, () => first.stop());
    first.keepBoth(first.conflicts()[0]!.id, mine => mine.map(edit => ({ ...edit, id: "c-1/copy" })));
    const second = new DocumentOutbox(r.port, storage, { retryMs: 5 });
    storage.killAfter(Infinity);
    second.open();
    expect(second.conflicts()).toEqual([]);
    await quiet(second);
    expect(value(r.store, { ...LOOK, id: "c-1/copy" })).toMatchObject({ value: { mine: 1 } });
    expect(value(r.store)).toMatchObject({ revision: 1, value: { theirs: 1 } });
  });

  test("a kill between a multi-document acknowledgement's key writes replays the command by receipt, and its successor follows", async () => {
    const r = rig(), storage = memoryOutboxStorage();
    const first = memoryOutbox(r.port, storage).outbox;
    const open = r.gate();
    first.commit("collection.addLook", [{ ...COLLECTION, value: { looks: ["l-1"] } }, { ...LOOK, value: { n: 1 } }]);
    await tick();
    first.commit("look.edit", [{ ...LOOK, value: { n: 2 } }]);
    storage.killAfter(1, () => first.stop()); // The answer comes back: one key's write lands, then the window dies.
    open();
    await tick(10);
    storage.killAfter(Infinity);
    const second = new DocumentOutbox(r.port, storage, { retryMs: 5 });
    second.open();
    await quiet(second);
    expect(second.conflicts()).toEqual([]);
    expect(value(r.store)).toMatchObject({ revision: 2, value: { n: 2 } });
    expect(value(r.store, COLLECTION)).toMatchObject({ revision: 1 });
  });
});

describe("the page's storage for the outbox", () => {
  const browserStorage = () => {
    const items = new Map<string, string>();
    return { items, get length() { return items.size; }, key: (i: number) => [...items.keys()][i] ?? null, getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, text: string) => { items.set(key, text); }, removeItem: (key: string) => { items.delete(key); } };
  };
  test("localhost: one key per document under the workspace's identity; another workspace's keys are never read", () => {
    const local = browserStorage();
    local.setItem("xfs.outbox.browser-other.look-working/x", "{}");
    const storage = localOutboxStorage(local, "browser-1");
    storage.write("look-working/c-1/l-1", "{\"a\":1}", false);
    expect([...local.items.keys()].sort()).toEqual(["xfs.outbox.browser-1.look-working/c-1/l-1", "xfs.outbox.browser-other.look-working/x"]);
    expect([...storage.load()]).toEqual([["look-working/c-1/l-1", "{\"a\":1}"]]);
    storage.write("look-working/c-1/l-1", "{}", true);
    expect(storage.load().size).toBe(0);
  });

  test("desktop: this launch's copy and the host's merge by stamp; an earlier launch's copy is dropped; host failures make it unprotected", async () => {
    const local = browserStorage();
    local.setItem("xfs.outbox.desktop~old.look-working/a", JSON.stringify({ schema: "xfs/outbox-1", stamp: 99, entries: [] }));
    local.setItem("xfs.outbox.desktop~now.look-working/b", JSON.stringify({ schema: "xfs/outbox-1", stamp: 7, entries: [{ id: "mine" }] }));
    const host = { "look-working/b": JSON.stringify({ schema: "xfs/outbox-1", stamp: 5, entries: [{ id: "older" }] }),
      "look-working/c": JSON.stringify({ schema: "xfs/outbox-1", stamp: 2, entries: [{ id: "host" }] }) };
    let failing = true;
    const posted: [string, string | null][] = [];
    const storage = desktopOutboxStorage(local, "desktop", "now", host, async (key, text) => { if (failing) throw Error("down"); posted.push([key, text]); });
    expect(local.getItem("xfs.outbox.desktop~old.look-working/a")).toBeNull();
    const loaded = storage.load();
    expect(JSON.parse(loaded.get("look-working/b")!).entries[0].id).toBe("mine");
    expect(JSON.parse(loaded.get("look-working/c")!).entries[0].id).toBe("host");
    const heard: [string, boolean][] = [];
    storage.watch!((key, stored) => heard.push([key, stored]));
    storage.write("look-working/b", JSON.stringify({ schema: "xfs/outbox-1", stamp: 8, entries: [] }), true);
    await tick(5);
    expect(heard).toEqual([["look-working/b", false]]);
    // The emptied key keeps its newer empty text here, so the host's older copy is never read back over it.
    expect(JSON.parse(local.getItem("xfs.outbox.desktop~now.look-working/b")!).stamp).toBe(8);
    failing = false;
    expect(await storage.settle()).toBe(true);
    expect(posted).toEqual([["look-working/b", null]]);
  });

  test("a decoded save's synchronous ID matches the browser's SHA-256", async () => {
    for (const text of ["", "abc", "x".repeat(1000), JSON.stringify({ a: "é漢字", b: [1, 2, 3] })]) {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
      expect(sha256Hex(text)).toBe(Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join(""));
    }
  });
});
