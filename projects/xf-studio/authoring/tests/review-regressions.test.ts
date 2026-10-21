/**
 * Regressions from the review of the platform's plain subsystems: one save owner per document across experiment reloads,
 * the true outcome for coalesced saves, re-entrant supersession, settled cancellation, read cancellation reaching the
 * transport, and tasks that let go of their lifetime.
 */
import { expect, test } from "bun:test";
import { createTask } from "../src/platform/core/tasks";
import { savedDocument } from "../src/platform/core/saved-document";
import { createExperiments, startExperiments } from "../src/platform/core/experiments";
import { browserDocuments } from "../src/browser-documents-device";
import { seededRandom } from "../src/platform/core/random";
import type { DocumentStorePort } from "../src/platform/api/document-store";
import { settle, storeDocuments } from "./fixtures/platform-doubles";

const never = () => new Promise<never>(() => {});
const within = <T>(promise: Promise<T>, ms = 200) => Promise.race([promise, new Promise<"pending">(resolve => setTimeout(() => resolve("pending"), ms))]);

test("1: reloading an experiment reuses the page's one save owner per document, so a delayed older write can't erase a newer edit", async () => {
  const documents = storeDocuments();
  documents.store.put("hair-groom", "g", { length: 1, waves: 1 }, 0);
  let gate: (() => void) | null = null, delayed = true;
  const port: DocumentStorePort = { list: documents.list,
    put: async (...args) => { if (delayed) { delayed = false; await new Promise<void>(resolve => { gate = resolve; }); } return documents.put(...args); } };
  const life = new AbortController(), platform = await createExperiments({ random: seededRandom(1), documents: port, signal: life.signal, definitions: [], overrides: {} });
  const stored = (await documents.list<{ length: number; waves: number }>("hair-groom"))[0];
  // The first instance edits the length; its write is held up.
  const first = platform.context.document("hair-groom", "g", stored.value, stored);
  const older = first.save({ ...first.value, length: 2 });
  await settle();
  // The experiment is turned off and on: the new instance reads the store again and edits the waves.
  const reread = (await documents.list<{ length: number; waves: number }>("hair-groom"))[0];
  const second = platform.context.document("hair-groom", "g", reread.value, reread);
  expect(second).toBe(first);
  const newer = second.save({ ...second.value, waves: 2 });
  gate!();
  await Promise.all([older, newer]);
  expect(documents.store.get("hair-groom", "g")!.value).toEqual({ length: 2, waves: 2 });
  life.abort();
});

test("2: every save covered by a coalesced write gets that write's outcome", async () => {
  const failing = savedDocument<number>({ list: async () => [], put: async () => { throw new Error("offline"); } }, "sample", "a", 0);
  const outcomes = await Promise.allSettled([failing.save(1), failing.save(2)]);
  expect(outcomes.map(outcome => outcome.status)).toEqual(["rejected", "rejected"]);
  const documents = storeDocuments();
  let puts = 0;
  const working = savedDocument<number>({ list: documents.list, put: (...args) => { puts++; return documents.put(...args); } }, "sample", "b", 0);
  await Promise.all([working.save(1), working.save(2), working.save(3)]);
  expect(puts).toBe(1); expect(documents.store.get("sample", "b")!.value).toBe(3);
  // A save made while a write is out waits for, and reports, the next write.
  let fail = false;
  const flaky = savedDocument<number>({ list: documents.list, put: async (...args) => { if (fail) throw new Error("offline"); return documents.put(...args); } }, "sample", "c", 0);
  const sent = flaky.save(1); await settle(); fail = true; const queued = flaky.save(2);
  expect((await Promise.allSettled([sent, queued])).map(outcome => outcome.status)).toEqual(["fulfilled", "rejected"]);
});

test("3: a run started from an abort listener during supersession wins, and stays cancellable", async () => {
  const task = createTask<string>();
  let reentered: Promise<unknown> | undefined, inner: AbortSignal | undefined;
  void task.run(signal => {
    signal.addEventListener("abort", () => { reentered ??= task.run(own => { inner = own; return never(); }); });
    return never();
  });
  const superseding = task.run(async () => "B");
  expect(await within(superseding)).toEqual({ status: "superseded" });
  expect(task.state()).toEqual({ phase: "running" });
  expect(inner!.aborted).toBe(false);
  task.cancel();
  expect(inner!.aborted).toBe(true);
  expect(await within(reentered!)).toEqual({ status: "superseded" });
  // A subscriber that starts a run when it hears `running` takes over before the outer work begins.
  const second = createTask<string>();
  let started = 0, nested = false;
  second.subscribe(state => { if (state.phase === "running" && !nested) { nested = true; void second.run(async () => "nested"); } });
  const outer = second.run(async () => { started++; return "outer"; });
  expect(await within(outer)).toEqual({ status: "superseded" });
  expect(started).toBe(0);
  await settle(); expect(second.state()).toEqual({ phase: "done", result: "nested" });
});

test("4: a cancelled or superseded run settles at once, and a late completion publishes nothing", async () => {
  const task = createTask<string>();
  let finish!: (value: string) => void;
  const stalled = task.run(() => new Promise<string>(resolve => { finish = resolve; }));
  task.cancel();
  expect(await within(stalled)).toEqual({ status: "superseded" });
  finish("late"); await settle();
  expect(task.state()).toEqual({ phase: "idle" });
  const waiting = task.run(never), next = task.run(async () => "next");
  expect(await within(waiting)).toEqual({ status: "superseded" });
  expect(await next).toEqual({ status: "done", result: "next" });
});

test("4: startup settles when its lifetime ends during a stalled read, and the read's cancellation reaches the transport", async () => {
  const life = new AbortController();
  let readSignal: AbortSignal | undefined;
  const stalled: DocumentStorePort = { list: (_kind, signal) => { readSignal = signal; return never(); }, put: never };
  const port = startExperiments({ definitions: [{ id: "sample", label: "Sample", description: "", load: never }], overrides: {}, random: seededRandom(2), documents: stalled, signal: life.signal });
  expect(await within(port.ready)).toBe("pending");
  const setting = port.set("sample", true);
  life.abort();
  expect(await within(port.ready)).toBe(false);
  expect((await within(setting) as { ok: boolean }).ok).toBe(false);
  expect(readSignal?.aborted).toBe(true);
  // The browser transport hands the read's signal to fetch.
  let sent: AbortSignal | null | undefined;
  const device = browserDocuments("/api/documents", async (_url, init) => { sent = init?.signal; return Response.json({ documents: [] }); });
  const read = new AbortController();
  await device.list("sample", read.signal);
  expect(sent).toBe(read.signal);
});

test("5: a task holds its lifetime's listener only while it has a current run", async () => {
  const life = new AbortController();
  let attached = 0;
  const add = life.signal.addEventListener.bind(life.signal), remove = life.signal.removeEventListener.bind(life.signal);
  life.signal.addEventListener = ((...args: Parameters<AbortSignal["addEventListener"]>) => { attached++; add(...args); }) as AbortSignal["addEventListener"];
  life.signal.removeEventListener = ((...args: Parameters<AbortSignal["removeEventListener"]>) => { attached--; remove(...args); }) as AbortSignal["removeEventListener"];
  for (let i = 0; i < 50; i++) { const task = createTask<number>({ signal: life.signal }); const run = task.run(never); task.cancel(); await within(run, 5); }
  for (let i = 0; i < 50; i++) { const task = createTask<number>({ signal: life.signal }); void task.run(never); await task.run(async () => i); task.cancel(); }
  expect(attached).toBe(0);
  // A current run still ends with the lifetime.
  const task = createTask<number>({ signal: life.signal });
  let signal!: AbortSignal;
  await task.run(own => { signal = own; return 1; });
  life.abort();
  expect(signal.aborted).toBe(true);
});
