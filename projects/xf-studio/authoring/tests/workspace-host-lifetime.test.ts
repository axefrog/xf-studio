import { expect, test } from "bun:test";
import { browserWorkspaceLease, desktopWorkspaceLease } from "../src/app/browser/workspace-lease-device";
import { WorkspaceLease } from "../src/app/workspace/workspace-lease";
import { bindWorkspaceHostLifetime, startDocumentOutbox } from "../src/app/browser/document-outbox-device";
import { createBrowserWorkspaceLifetime } from "../src/app/browser/browser-workspace-device";
import { memoryOutboxStorage } from "./fixtures/platform-doubles";
import { desktopOutboxStorage } from "../src/app/browser/outbox-storage";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const clock = { after() {} };
const channel = () => {
  const listeners = new Set<(event: MessageEvent) => void>(), posts: unknown[] = [];
  let closed = 0;
  return { listeners, posts, get closed() { return closed; },
    addEventListener: (_type: "message", listener: (event: MessageEvent) => void) => { listeners.add(listener); },
    removeEventListener: (_type: "message", listener: (event: MessageEvent) => void) => { listeners.delete(listener); },
    postMessage: (value: unknown) => { expect(closed).toBe(0); posts.push(value); }, close: () => { closed++; } };
};

test("an already stopped handover outbox permits clean workspace retirement", async () => {
  const lease = new WorkspaceLease({ acquire: async () => ({ generation: 1 }), takeOver: async () => ({ generation: 2 }),
    onReleaseRequested() {}, release: async () => {} }, { clock });
  await lease.start();
  const documents = startDocumentOutbox({ workspace: "test", prefix: "/documents", lease, storage: memoryOutboxStorage(),
    send: (async () => { throw Error("No writes expected"); }) as unknown as typeof fetch });
  expect(await lease.release()).toBe(true); expect(documents.outbox.status().stopped).toBe(true);
  const life = createBrowserWorkspaceLifetime(new EventTarget() as unknown as Window);
  life.beforeRelease(documents.prepareRelease); life.abort();
  expect(life.signal.aborted).toBe(true); await documents.stop(); await lease.stop();
});

test("handover protects failed conflict backups before release and old cleanup never overwrites the second holder", async () => {
  const shared = memoryOutboxStorage(), ref = { kind: "sample", id: "a" };
  let released = false, broken = true, writesAfterRelease = 0, settlesAfterRelease = 0;
  let second: ReturnType<typeof startDocumentOutbox> | undefined;
  const secondLease = new WorkspaceLease({ acquire: async () => ({ generation: 2 }), takeOver: async () => ({ generation: 3 }),
    onReleaseRequested() {}, release: async () => {} }, { clock });
  const lease = new WorkspaceLease({ acquire: async () => ({ generation: 1 }), takeOver: async () => ({ generation: 2 }),
    onReleaseRequested() {}, release: async () => {
      released = true; await secondLease.start();
      second = startDocumentOutbox({ workspace: "test", prefix: "/documents", lease: secondLease, storage: shared,
        send: (async () => Response.json({ ok: false, reason: "stale", current: { "sample/a": { revision: 1, value: "theirs" } } })) as unknown as typeof fetch });
      await second.outbox.settle();
      second.outbox.commit("second holder", [{ ...ref, value: "new holder" }]);
    } }, { clock });
  await lease.start();
  const first = startDocumentOutbox({ workspace: "test", prefix: "/documents", lease,
    send: (async () => Response.json({ ok: false, reason: "stale", current: { "sample/a": { revision: 1, value: "theirs" } } })) as unknown as typeof fetch,
    storage: { ...shared, write: (key, text, empty) => {
      if (released) writesAfterRelease++;
      if (broken && JSON.parse(text).entries.some((entry: { state: string }) => entry.state === "conflict")) throw Error("Conflict backup failed");
      shared.write(key, text, empty);
    }, settle: async () => { if (released) settlesAfterRelease++; return true; } } });
  try {
    first.outbox.commit("first holder", [{ ...ref, value: "mine" }]);
    expect(await first.outbox.settle()).toBe(true);
    expect(first.outbox.status()).toMatchObject({ conflicts: 1, unprotectedWarning: true });
    const initiallyReleased = await lease.release(), retained = lease.writable();
    broken = false;
    if (!initiallyReleased) expect(await lease.retryRelease()).toBe(true);
    const secondKey = shared.load().get("sample/a");
    await first.stop(); await first.stop(); first.outbox.stop(); first.outbox.protect(); first.outbox.store(); first.outbox.retry(); await tick();
    expect({ initiallyReleased, retained, writesAfterRelease, settlesAfterRelease, unchanged: shared.load().get("sample/a") === secondKey })
      .toEqual({ initiallyReleased: false, retained: true, writesAfterRelease: 0, settlesAfterRelease: 0, unchanged: true });
    expect(second?.outbox.document(ref)?.value).toBe("new holder");
  } finally { broken = false; await first.stop(); await second?.stop(); await lease.stop(); await secondLease.stop(); }
});

test("failed shutdown plus in-flight transport failure suspends commands and bounds retries while retaining recovery", async () => {
  const storage = memoryOutboxStorage(), response = Promise.withResolvers<Response>();
  let sends = 0, writes = 0, broken = true, safetyTripped = false;
  const lease = new WorkspaceLease({ acquire: async () => ({ generation: 1 }), takeOver: async () => ({ generation: 2 }),
    onReleaseRequested() {}, release: async () => {} }, { clock });
  await lease.start();
  const documents = startDocumentOutbox({ workspace: "test", prefix: "/documents", lease,
    send: (async () => { sends++; return response.promise; }) as unknown as typeof fetch,
    storage: { ...storage, write: (...args) => {
      // Let the unfixed loop finish rather than starving the test process forever.
      if (broken && ++writes <= 12) throw Error("Backup unavailable");
      if (broken) safetyTripped = true;
      storage.write(...args);
    } } });
  const entry = documents.outbox.commit("edit", [{ kind: "sample", id: "a", value: 13 }]);
  await tick();
  try {
    expect(await documents.stop()).toBe(false);
    response.reject(Error("In-flight transport failed")); await tick();
    documents.outbox.retry(); await tick();
    expect({ sends, writes, safetyTripped }).toEqual({ sends: 1, writes: 2, safetyTripped: false });
    expect(documents.outbox.status()).toMatchObject({ stopped: false, pending: 1, unprotectedWarning: true });
    expect(documents.outbox.pendingEntries()[0]?.id).toBe(entry.id);
    expect(documents.outbox.document({ kind: "sample", id: "a" })?.value).toBe(13);
    expect(lease.generation()).toBe(1);
    expect(() => documents.outbox.commit("late", [{ kind: "sample", id: "a", value: 14 }])).toThrow("workspace was released");
  } finally { broken = false; response.reject(Error("Ended")); await documents.stop(); await lease.stop(); }
});

test("localhost stop releases its held Web Lock and channel exactly once", async () => {
  const bus = channel(); let held = 0;
  const locks = { request: async (_name: string, _options: unknown, callback: (lock: unknown) => unknown) => {
    held++; try { return await callback({}); } finally { held--; }
  } } as unknown as Pick<LockManager, "request">;
  const adapter = browserWorkspaceLease({ workspace: "test", locks, channel: bus, register: async () => 4 });
  const lease = new WorkspaceLease(adapter, { clock });
  await lease.start(); expect(held).toBe(1); expect(bus.listeners.size).toBe(1);
  await lease.stop(); await lease.stop();
  expect(held).toBe(0); expect(bus.closed).toBe(1); expect(bus.listeners.size).toBe(0);
  expect(lease.generation()).toBeNull(); expect(lease.writable()).toBe(false);
  expect(await lease.takeOver()).toMatchObject({ ok: false, message: "This workspace was released." });
});

test("localhost stop during generation registration ignores an uncancellable late grant", async () => {
  const gate = Promise.withResolvers<number | null>(), bus = channel(); let held = 0;
  const locks = { request: async (_name: string, _options: unknown, callback: (lock: unknown) => unknown) => {
    held++; try { return await callback({}); } finally { held--; }
  } } as unknown as Pick<LockManager, "request">;
  const adapter = browserWorkspaceLease({ workspace: "test", locks, channel: bus, register: () => gate.promise });
  const lease = new WorkspaceLease(adapter, { clock }), starting = lease.start();
  await tick(); await lease.stop(); gate.resolve(9); await starting;
  expect(held).toBe(0); expect(bus.closed).toBe(1); expect(lease.generation()).toBeNull();
});

test("localhost stop withdraws a queued takeover and its repeating requests", async () => {
  const bus = channel(); let requests = 0;
  const locks = { request: (_name: string, options: LockOptions) => { requests++;
    return new Promise((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true }));
  } } as unknown as Pick<LockManager, "request">;
  const adapter = browserWorkspaceLease({ workspace: "test", locks, channel: bus, register: async () => 1, repeatMs: 1 });
  const waiting = adapter.takeOver(new AbortController().signal).catch(() => "withdrawn");
  await adapter.stop(); const posted = bus.posts.length;
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(await waiting).toBe("withdrawn"); expect(requests).toBe(1); expect(bus.posts.length).toBe(posted);
  expect(bus.closed).toBe(1);
});

for (const granted of [false, true]) test(`desktop stop ends the stream and ${granted ? "withdraws takeover" : "refuses pending acquisition"}`, async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>, cancelled = 0, fetchSignal: AbortSignal | undefined;
  const adapter = desktopWorkspaceLease({ endpoint: "/lease", send: async (_url, init) => {
    if (init?.method === "POST") return new Response(null, { status: 204 });
    fetchSignal = init?.signal ?? undefined;
    return new Response(new ReadableStream<Uint8Array>({ start: controller => { stream = controller; }, cancel: () => { cancelled++; } }));
  } });
  const acquired = adapter.acquire(new AbortController().signal);
  const outcome = acquired.catch(() => "ended"); await tick();
  if (granted) stream.enqueue(new TextEncoder().encode('{"event":"held"}\n'));
  if (granted) expect(await acquired).toBeNull();
  const waiting = granted ? adapter.takeOver(new AbortController().signal).catch(() => "ended") : outcome;
  await adapter.stop(); await adapter.stop();
  expect(await waiting).toBe("ended"); expect(cancelled).toBe(1); expect(fetchSignal?.aborted).toBe(true);
  expect(adapter.generation()).toBeNull();
});

test("desktop stop fences a late stream response and cancels its unused body", async () => {
  const response = Promise.withResolvers<Response>(); let cancelled = 0;
  const adapter = desktopWorkspaceLease({ endpoint: "/lease", send: () => response.promise });
  const acquired = adapter.acquire(new AbortController().signal).catch(() => "ended");
  await adapter.stop(); expect(await acquired).toBe("ended");
  response.resolve(new Response(new ReadableStream<Uint8Array>({ cancel: () => { cancelled++; } })));
  await tick(); expect(cancelled).toBe(1); expect(adapter.generation()).toBeNull();
});

test("root abort persists pending outbox writes and waits for durable storage before ending its lease", async () => {
  const events: string[] = [], durable = Promise.withResolvers<boolean>(), storage = memoryOutboxStorage();
  let stopped = false, focus = 0, sends = 0;
  const lease = new WorkspaceLease({ acquire: async () => ({ generation: 1 }), takeOver: async () => ({ generation: 2 }),
    onReleaseRequested() {}, release: async () => {}, stop: async () => { stopped = true; events.push("lease"); } }, { clock });
  await lease.start();
  const documents = startDocumentOutbox({ prefix: "/documents", workspace: "test", lease,
    send: (async () => { sends++; return Response.json({ ok: true, revisions: {} }); }) as unknown as typeof fetch,
    storage: { ...storage, write: (...args) => { events.push("stored"); storage.write(...args); }, settle: () => durable.promise },
    page: { addEventListener() { focus++; }, removeEventListener() { focus--; }, visible: () => false } });
  const page = new EventTarget(), life = createBrowserWorkspaceLifetime(page as unknown as Window);
  let releaseAllowed = false;
  life.beforeRelease(() => { events.push("workspace"); return releaseAllowed; });
  const errors: unknown[] = [];
  bindWorkspaceHostLifetime(documents, lease, life.signal, error => errors.push(error));
  documents.outbox.commit("edit", [{ kind: "sample", id: "a", value: 2 }], { store: "soon" });
  life.abort(); expect(life.signal.aborted).toBe(false); expect(lease.writable()).toBe(true);
  expect(documents.outbox.status().stopped).toBe(false); expect(events).toEqual(["workspace"]);
  releaseAllowed = true; life.abort(); await tick();
  expect(documents.outbox.status().stopped).toBe(true); expect(focus).toBe(0); expect(stopped).toBe(false);
  expect(JSON.parse(storage.load().get("sample/a")!).entries[0].writes[0].value).toBe(2);
  expect(() => documents.outbox.commit("late", [{ kind: "sample", id: "a", value: 3 }])).toThrow("workspace was released");
  expect(await documents.documents.transact({ id: "late", command: "late", writes: [] })).toEqual({ ok: false, reason: "superseded" });
  expect(sends).toBe(0);
  durable.resolve(true); await tick();
  expect(stopped).toBe(true); expect(events).toEqual(["workspace", "workspace", "stored", "lease"]); expect(errors).toEqual([]);
});

test("failed durable outbox handoff keeps the lease and its pending recovery entry", async () => {
  let stopped = 0;
  const lease = new WorkspaceLease({ acquire: async () => ({ generation: 1 }), takeOver: async () => ({ generation: 2 }),
    onReleaseRequested() {}, release: async () => {}, stop: async () => { stopped++; } }, { clock });
  await lease.start();
  const storage = memoryOutboxStorage(), life = new AbortController(), errors: unknown[] = [];
  let saved = false;
  const documents = startDocumentOutbox({ prefix: "/documents", workspace: "test", lease,
    storage: { ...storage, settle: async () => saved }, send: (async () => { throw Error("Must not send"); }) as unknown as typeof fetch });
  bindWorkspaceHostLifetime(documents, lease, life.signal, error => errors.push(error));
  documents.outbox.commit("edit", [{ kind: "sample", id: "a", value: 2 }], { store: "soon" });
  life.abort(); await tick();
  expect(stopped).toBe(0); expect(errors.map(String)).toEqual(["Error: Pending changes could not be protected. The workspace lease was kept for recovery."]);
  expect(storage.load().has("sample/a")).toBe(true);
  saved = true; expect(await documents.stop()).toBe(true); await lease.stop(); expect(stopped).toBe(1);
});

test("desktop in-flight backup lands under the held generation before root releases its stream", async () => {
  const events: string[] = [], values = new Map<string, string>(), host = new Map<string, string>();
  const disk = Promise.withResolvers<void>(), reply = Promise.withResolvers<Response>();
  const lease = new WorkspaceLease({ acquire: async () => ({ generation: 8 }), takeOver: async () => ({ generation: 9 }),
    onReleaseRequested() {}, release: async () => {}, stop: async () => { events.push("stream ended"); } }, { clock });
  await lease.start();
  const local = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, key: (at: number) => [...values.keys()][at] ?? null, get length() { return values.size; } };
  const storage = desktopOutboxStorage(local, "desktop", "launch", {}, async (key, text) => {
    events.push("backup started"); await disk.promise;
    expect(lease.generation()).toBe(8); if (text) host.set(key, text); events.push("backup durable");
  });
  const documents = startDocumentOutbox({ workspace: "desktop", prefix: "/documents", lease, storage,
    send: (async () => reply.promise) as unknown as typeof fetch });
  const life = new AbortController(), errors: unknown[] = [];
  bindWorkspaceHostLifetime(documents, lease, life.signal, error => errors.push(error));
  const entry = documents.outbox.commit("edit", [{ kind: "sample", id: "a", value: 12 }]);
  await tick(); life.abort(); await tick(); expect(events).toEqual(["backup started"]);
  disk.resolve(); await tick(); expect(events).toEqual(["backup started", "backup durable", "stream ended"]);
  expect(JSON.parse(host.get("sample/a")!).entries[0].id).toBe(entry.id);
  reply.resolve(Response.json({ ok: true, revisions: { "sample/a": 1 } })); await tick();
  expect(documents.outbox.pendingEntries()[0]?.id).toBe(entry.id); expect(errors).toEqual([]);
});
