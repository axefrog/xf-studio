/**
 * Regressions from the review of the platform's plain subsystems: one save owner per document across experiment reloads,
 * the true outcome for coalesced saves, re-entrant supersession, settled cancellation, read cancellation reaching the
 * transport, and tasks that let go of their lifetime.
 */
import { expect, test } from "bun:test";
import { createTask } from "../src/platform/core/tasks";
import { documentOwners } from "../src/platform/core/saved-document";
import { createExperiments, startExperiments } from "../src/platform/core/experiments";
import { browserDocuments } from "../src/app/browser/browser-documents-device";
import { seededRandom } from "../src/platform/core/random";
import type { DocumentStorePort, SavedDocument } from "../src/platform/api/document-store";
import type { ExperimentContext } from "../src/platform/api/experiment-context";
import { memoryOutbox, settle, storeDocuments } from "./fixtures/platform-doubles";

const never = () => new Promise<never>(() => {});
const within = <T>(promise: Promise<T>, ms = 200) => Promise.race([promise, new Promise<"pending">(resolve => setTimeout(() => resolve("pending"), ms))]);

type Groomish = { length: number; waves: number };

/**
 * An experiment platform whose one experiment ("sample") loads its `hair-groom` documents through the context each time it
 * is turned on, as Hair Lab does; `instances` holds each enabled instance's documents.
 */
async function toggledPlatform(port: DocumentStorePort) {
  const instances: (readonly SavedDocument<Groomish>[])[] = [];
  const life = new AbortController();
  const platform = await createExperiments({ random: seededRandom(1), documents: port, outbox: memoryOutbox(port).outbox, signal: life.signal, overrides: {}, definitions: [{
    id: "sample", label: "Sample", description: "",
    load: async () => ({ create: async (context: ExperimentContext) => {
      instances.push(await context.loadDocuments<Groomish>("hair-groom", context.signal));
      return { service: { subscribe: () => () => {} } } as never;
    } }) }] });
  const toggle = async (enabled: boolean) => { await platform.set("sample", enabled); await settle(); };
  return { platform, instances, toggle, life };
}

test("1: turning an experiment off and on reuses the page's one save owner per document, so a delayed older write can't erase a newer edit", async () => {
  const documents = storeDocuments();
  documents.store.put("hair-groom", "g", { length: 1, waves: 1 }, 0);
  let gate: (() => void) | null = null, hold = false;
  const port: DocumentStorePort = { ...documents,
    transact: async request => { if (hold && request.writes[0]!.kind === "hair-groom") { hold = false; await new Promise<void>(resolve => { gate = resolve; }); } return documents.transact(request); } };
  const { instances, toggle, life } = await toggledPlatform(port);
  await toggle(true);
  // The first instance edits the length; its write is held up.
  const [first] = instances[0];
  hold = true;
  const older = first.save({ ...first.value, length: 2 });
  await settle();
  // Turned off and on: the new instance reads the store again and edits the waves.
  await toggle(false); await toggle(true);
  const [second] = instances[1];
  expect(second).toBe(first);
  const newer = second.save({ ...second.value, waves: 2 });
  gate!();
  await Promise.all([older, newer]);
  expect(documents.store.get("hair-groom", "g")!.value).toEqual({ length: 2, waves: 2 });
  life.abort();
});

test("1b: a clean holder takes a newer revision written elsewhere when the experiment reloads; the next edit keeps that change", async () => {
  const documents = storeDocuments();
  documents.store.put("hair-groom", "g", { length: 1, waves: 1 }, 0);
  const { instances, toggle, life } = await toggledPlatform(documents);
  await toggle(true);
  const [held] = instances[0];
  await held.save({ ...held.value, length: 2 });   // saved: the holder is clean again
  // Another window changes the waves.
  const stored = documents.store.get<Groomish>("hair-groom", "g")!;
  documents.store.put("hair-groom", "g", { ...stored.value, waves: 3 }, stored.revision);
  await toggle(false); await toggle(true);
  const [reloaded] = instances[1];
  expect(reloaded).toBe(held);
  expect(reloaded.value).toEqual({ length: 2, waves: 3 });
  await reloaded.save({ ...reloaded.value, length: 4 });
  expect(documents.store.get("hair-groom", "g")!.value).toEqual({ length: 4, waves: 3 });
  // A holder with an unsent edit keeps it, in the outbox, whatever the store says.
  const failing: DocumentStorePort = { ...documents, transact: async () => { throw new Error("offline"); } };
  const offline = await toggledPlatform(failing);
  await offline.toggle(true);
  const [dirty] = offline.instances[0];
  void dirty.save({ ...dirty.value, length: 9 });
  const latest = documents.store.get<Groomish>("hair-groom", "g")!;
  documents.store.put("hair-groom", "g", { ...latest.value, waves: 5 }, latest.revision);
  await offline.toggle(false); await offline.toggle(true);
  expect(offline.instances[1][0].value).toEqual({ length: 9, waves: 3 });
  life.abort(); offline.life.abort();
});

test("2: every save covered by a coalesced command gets that command's outcome; one made while it is out waits for the next", async () => {
  const documents = storeDocuments();
  let commands = 0, release: (() => void) | null = null, holdNext = false;
  const port: DocumentStorePort = { ...documents, transact: async request => {
    commands++;
    if (holdNext) { holdNext = false; await new Promise<void>(resolve => { release = resolve; }); }
    return documents.transact(request);
  } };
  const { outbox } = memoryOutbox(port);
  const owners = documentOwners(outbox);
  const working = owners.open("sample", "b", 0);
  await Promise.all([working.save(1), working.save(2), working.save(3)]);
  expect(commands).toBe(1); expect(documents.store.get("sample", "b")!.value).toBe(3);
  // A save made while a command is out goes into its successor and resolves when that is in the library.
  holdNext = true;
  const sent = working.save(4);
  await settle();
  const queued = working.save(5);
  let queuedDone = false;
  void queued.then(() => { queuedDone = true; });
  release!();
  await sent;
  await queued;
  expect(queuedDone).toBe(true);
  expect(documents.store.get("sample", "b")).toMatchObject({ revision: 3, value: 5 });
  // A save that went stale waits as a conflict; Use theirs rejects it.
  documents.store.transact({ id: "other", command: "x", writes: [{ kind: "sample", id: "b", base: 3, value: 99 }] });
  const stale = working.save(6);
  for (let i = 0; i < 50 && !outbox.conflicts().length; i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(await within(stale, 20)).toBe("pending");
  outbox.useTheirs(outbox.conflicts()[0]!.id);
  await expect(stale).rejects.toThrow("changed elsewhere");
  expect(working.value).toBe(99);
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
  const stalled: DocumentStorePort = { list: (_kind, signal) => { readSignal = signal; return never(); }, transact: never, revisions: never, read: never };
  const port = startExperiments({ definitions: [{ id: "sample", label: "Sample", description: "", load: never }], overrides: {}, random: seededRandom(2), documents: stalled,
    outbox: memoryOutbox(stalled).outbox, signal: life.signal });
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

test("6: a transition made by one subscriber ends the publication the others were hearing", async () => {
  const task = createTask<string>(), heard: Record<string, string[]> = { a: [], b: [], c: [] };
  let started = false;
  task.subscribe(state => { heard.a.push(state.phase); if (state.phase === "running") task.cancel(); });
  task.subscribe(state => heard.b.push(state.phase));
  task.subscribe(state => heard.c.push(state.phase));
  expect(await task.run(async () => { started = true; return "work"; })).toEqual({ status: "superseded" });
  expect(started).toBe(false);
  expect(heard).toEqual({ a: ["running", "idle"], b: ["idle"], c: ["idle"] });
  expect(task.state()).toEqual({ phase: "idle" });
});
