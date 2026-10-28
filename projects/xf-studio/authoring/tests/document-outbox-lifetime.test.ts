import { expect, test } from "bun:test";
import { DocumentOutbox, type OutboxEvent, type OutboxTransport } from "../src/platform/core/document-outbox";
import type { TransactAnswer } from "../src/platform/api/document-commands";
import { memoryOutboxStorage, storeDocuments } from "./fixtures/platform-doubles";

const ref = { kind: "sample", id: "a" };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function timers() {
  const waiting = new Set<() => void>();
  return { waiting, schedule: (_ms: number, run: () => void) => { waiting.add(run); return { cancel: () => { waiting.delete(run); } }; } };
}

test("stop persists deferred edits, cancels all owner timers and refuses every late write", async () => {
  const storage = memoryOutboxStorage(), time = timers(); let sends = 0;
  const port: OutboxTransport = { transact: async () => { sends++; return { ok: true, revisions: {} }; }, revisions: async () => ({}), read: async () => ({}) };
  const outbox = new DocumentOutbox(port, storage, { schedule: time.schedule, immutable: kind => kind === "blob" }); outbox.open();
  outbox.commit("edit", [{ ...ref, value: 4 }], { store: "soon" });
  expect(storage.load().size).toBe(0); expect(time.waiting.size).toBeGreaterThan(0);
  expect(outbox.stop()).toBe(true); expect(time.waiting.size).toBe(0);
  expect(JSON.parse(storage.load().get("sample/a")!).entries[0].writes[0].value).toBe(4);
  const before = [...storage.load()];
  expect(() => outbox.commit("late", [{ ...ref, value: 5 }])).toThrow("workspace was released");
  expect(() => outbox.put({ kind: "blob", id: "hash" }, "late")).toThrow("workspace was released");
  outbox.store(); outbox.retry(); outbox.protect(); await tick();
  expect([...storage.load()]).toEqual(before); expect(sends).toBe(0);
});

for (const committed of [false, true]) test(`in-flight abort preserves the original command for ${committed ? "receipt replay after commit" : "retry after lost transport"}`, async () => {
  const library = storeDocuments(), storage = memoryOutboxStorage(), time = timers();
  const answer = Promise.withResolvers<TransactAnswer>(), events: OutboxEvent[] = [];
  let sent: Parameters<OutboxTransport["transact"]>[0] | undefined, signal: AbortSignal | undefined;
  const port: OutboxTransport = { ...library, transact: (request, abort) => {
    sent = structuredClone(request); signal = abort;
    if (committed) library.store.transact(request);
    return answer.promise;
  } };
  const outbox = new DocumentOutbox(port, storage, { schedule: time.schedule }); outbox.open(); outbox.subscribe(event => events.push(event));
  const entry = outbox.commit("edit", [{ ...ref, value: 6 }]); await tick();
  expect(sent?.id).toBe(entry.id); const settled = outbox.settled(entry.id);
  expect(outbox.stop()).toBe(true); expect(await settled).toBe("stopped"); expect(signal?.aborted).toBe(true);
  const before = [...storage.load()], published = events.length;
  if (committed) answer.resolve({ ok: true, revisions: { "sample/a": 1 } }); else answer.reject(Error("Transport lost"));
  await tick(); expect(events.length).toBe(published); expect([...storage.load()]).toEqual(before); expect(time.waiting.size).toBe(0);
  const retried: string[] = [];
  const next = new DocumentOutbox({ ...library, transact: async request => { retried.push(request.id); return library.store.transact(request); } }, storage);
  next.open(); expect(await next.settle()).toBe(true);
  expect(retried).toEqual([entry.id]); expect(library.store.get(ref.kind, ref.id)).toMatchObject({ revision: 1, value: 6 });
  next.stop();
});

test("a failed synchronous backup refuses stop and preserves pending work until a successful retry", async () => {
  const storage = memoryOutboxStorage(), time = timers(); let broken = true;
  const outbox = new DocumentOutbox({ transact: async () => { throw Error("Must not send"); }, revisions: async () => ({}), read: async () => ({}) },
    { ...storage, write: (...args) => { if (broken) throw Error("Disk refused backup"); storage.write(...args); } }, { schedule: time.schedule });
  outbox.open(); outbox.commit("edit", [{ ...ref, value: 7 }], { store: "soon" });
  expect(outbox.stop()).toBe(false); expect(outbox.status()).toMatchObject({ stopped: false, pending: 1, unprotectedWarning: true });
  expect(outbox.document(ref)?.value).toBe(7); expect(storage.load().size).toBe(0);
  broken = false; expect(outbox.stop()).toBe(true);
  expect(JSON.parse(storage.load().get("sample/a")!).entries[0].writes[0].value).toBe(7); expect(time.waiting.size).toBe(0);
});

test("revision and required-content reads are aborted and publish no late state after stop", async () => {
  const read = Promise.withResolvers<Record<string, { revision: number; value: unknown }>>(), time = timers();
  const events: OutboxEvent[] = [], signals: AbortSignal[] = [];
  const port: OutboxTransport = { transact: async () => { throw Error("Must not send"); }, revisions: async () => ({ "sample/a": 2 }),
    read: (_refs, signal) => { signals.push(signal!); return read.promise; } };
  const outbox = new DocumentOutbox(port, memoryOutboxStorage(), { schedule: time.schedule }); outbox.open();
  outbox.hold(ref, { revision: 1, value: 1 }); outbox.subscribe(event => events.push(event));
  const checking = outbox.check();
  outbox.commit("requires", [{ kind: "sample", id: "b", value: 3 }], { requires: [{ kind: "blob", id: "missing" }] });
  await tick(); outbox.stop(); const published = events.length;
  read.resolve({ "sample/a": { revision: 2, value: 9 }, "blob/missing": { revision: 1, value: "late" } });
  expect(await checking).toEqual([]); await tick();
  expect(signals.length).toBe(2); expect(signals.every(signal => signal.aborted)).toBe(true);
  expect(events.length).toBe(published); expect(outbox.document(ref)?.value).toBe(1);
  expect(outbox.document({ kind: "blob", id: "missing" })).toBeNull(); expect(time.waiting.size).toBe(0);
});
