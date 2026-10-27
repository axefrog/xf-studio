import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createExperiments, startExperiments } from "../src/platform/core/experiments";
import { EXPERIMENT_FLAGS } from "../src/platform/api/experiments";
import type { DocumentStorePort } from "../src/platform/api/document-store";
import { seededRandom } from "../src/platform/core/random";
import { memoryOutbox, storeDocuments } from "./fixtures/platform-doubles";
import { createHistoryService } from "../src/platform/core/history-service";
import { FocusService } from "../src/platform/core/focus";
/** The random source, and an outbox over `documents` (every write goes through it). */
const sources = (documents: DocumentStorePort = storeDocuments()) => ({ random: seededRandom(29), documents, outbox: memoryOutbox(documents).outbox });
const definition = { id: "sample", label: "Sample", description: "Test", load: async () => { throw Error("must stay off"); } };

test("restored document focus cannot reach an experiment history provider before its state is initialized", async () => {
  const history = createHistoryService({ focus: new FocusService({ seq: 0, views: {}, editing: "doc:hair:g" }) }), life = new AbortController(), src = sources();
  let reads = 0;
  const off = history.subscribe(() => { reads++; history.acting(history.focus.recent()); });
  const loaded = { ...definition, load: async () => ({ create: () => ({ service: { subscribe: () => () => {} },
    histories: () => [{ id: "hair:g", dispatch: () => true }] }) as never }) };
  try {
    const experiments = await createExperiments({ definitions: [loaded], overrides: { sample: true }, ...src, history, signal: life.signal });
    const deadline = Date.now() + 1000;
    while (!experiments.registrations().length && Date.now() < deadline) await Bun.sleep(1);
    expect(experiments.registrations()).toHaveLength(1); expect(reads).toBeGreaterThan(0);
    expect(history.acting(history.focus.recent())?.id).toBe("doc:hair:g");
    life.abort(); expect(history.acting(history.focus.recent())).toBeNull();
  } finally { off(); life.abort(); src.outbox.stop(); }
});

test("aborting from the initial history publication still removes the experiment's provider", async () => {
  const history = createHistoryService(), life = new AbortController(), src = sources();
  let providers = 0;
  const original = history.participants.bind(history);
  history.participants = provider => {
    providers++;
    const off = original(provider);
    return () => { providers--; off(); };
  };
  const off = history.subscribe(() => life.abort());
  try {
    await createExperiments({ definitions: [definition], overrides: {}, ...src, history, signal: life.signal });
    expect(providers).toBe(0);
  } finally { off(); life.abort(); src.outbox.stop(); }
});

test("experimental store failure never blocks synchronous all-off startup", async () => {
  const unavailable = async () => { throw Error("store unavailable"); };
  const life = new AbortController(), documents: DocumentStorePort = { list: unavailable, transact: unavailable, revisions: unavailable, read: unavailable };
  const port = startExperiments({ definitions: [definition], overrides: {}, ...sources(documents), signal: life.signal });
  expect(port.snapshot()[0].enabled).toBe(false); expect(port.registrations()).toEqual([]);
  expect(await port.ready).toBe(false); expect(port.snapshot()[0].phase).toBe("failed"); expect((await port.set("sample", true)).ok).toBe(false); life.abort();
});

test("the desktop startup bundle contains no Hair Lab feature or worker import", async () => {
  // A file path from the URL (a pathname with its slash stripped is a relative path everywhere but Windows).
  const result = await Bun.build({ entrypoints: [fileURLToPath(new URL("../src/compose/studio-startup.ts", import.meta.url))], target: "browser" });
  expect(result.success).toBe(true); const text = await result.outputs[0].text();
  expect(text).not.toContain("hair-lab-experiment"); expect(text).not.toContain("/build/hair-worker.js");
});

test("read-only startup writes no preference; repeated sets keep one document", async () => {
  const life = new AbortController(), documents = storeDocuments();
  const src = sources(documents);
  const port = await createExperiments({ definitions: [definition], overrides: {}, ...src, signal: life.signal });
  expect(documents.store.list(EXPERIMENT_FLAGS.kind)).toEqual([]);
  await port.set("sample", false); await port.set("sample", false);
  await src.outbox.settle();
  const stored = documents.store.list(EXPERIMENT_FLAGS.kind);
  expect(stored.map(item => item.id)).toEqual([EXPERIMENT_FLAGS.id]);
  expect(stored[0].value).toEqual({ schema: EXPERIMENT_FLAGS.schema, flags: { sample: false } }); life.abort();
});

test("quick successive sets are saved in order and the newest wins", async () => {
  const life = new AbortController(), documents = storeDocuments();
  const src = sources(documents);
  const port = await createExperiments({ definitions: [{ ...definition, id: "a" }, { ...definition, id: "b" }], overrides: {}, ...src, signal: life.signal });
  const results = await Promise.all([port.set("a", false), port.set("b", false), port.set("a", false)]);
  expect(results.every(result => result.ok)).toBe(true);
  await src.outbox.settle();
  expect((documents.store.get(EXPERIMENT_FLAGS.kind, EXPERIMENT_FLAGS.id)!.value as { flags: unknown }).flags).toEqual({ a: false, b: false }); life.abort();
});

test("a lost save acknowledgement is sent again under its ID and confirmed by its receipt, never applied twice", async () => {
  const life = new AbortController(), documents = storeDocuments();
  let lose = 1;
  const flaky: DocumentStorePort = { ...documents, transact: async request => { const answer = await documents.transact(request); if (lose-- > 0) throw Error("acknowledgement lost"); return answer; } };
  const loaded = { ...definition, load: async () => ({ create: () => ({ service: { subscribe: () => () => {} } }) as never }) };
  const src = sources(flaky);
  const port = await createExperiments({ definitions: [loaded], overrides: {}, ...src, signal: life.signal });
  expect((await port.set("sample", true)).ok).toBe(true); expect(port.snapshot()[0].enabled).toBe(true);
  expect(await src.outbox.settle()).toBe(false); // The answer was lost: sent again shortly.
  expect(await src.outbox.settle()).toBe(true); expect(port.snapshot()[0].message).toBe("");
  expect(documents.store.get(EXPERIMENT_FLAGS.kind, EXPERIMENT_FLAGS.id)).toMatchObject({ revision: 1, value: { flags: { sample: true } } });
  life.abort();
  const nextLife = new AbortController(), next = await createExperiments({ definitions: [definition], overrides: {}, ...sources(documents), signal: nextLife.signal });
  expect(next.snapshot()[0].enabled).toBe(true); nextLife.abort();
});

test("the registration generation moves only when the enabled set changes: on load and on switch-off, never for service changes", async () => {
  const life = new AbortController(), documents = storeDocuments(), src = sources(documents);
  let poke: () => void = () => {};
  const loaded = { ...definition, load: async () => ({ create: () => ({ module: { id: "sample" }, service: { subscribe: (listener: () => void) => { poke = listener; return () => {}; } } }) as never }) };
  const port = await createExperiments({ definitions: [loaded], overrides: {}, ...src, signal: life.signal });
  const signals: number[] = [];
  port.onRegistrationsChanged(() => signals.push(port.registrationGeneration()));
  expect(port.registrationGeneration()).toBe(0);
  await port.set("sample", true);
  for (let i = 0; i < 50 && !port.registrations().length; i++) await new Promise(resolve => setTimeout(resolve, 2));
  expect(port.registrations()).toHaveLength(1);
  expect(signals).toEqual([1]);
  poke(); poke(); // the experiment's own service changes: general notifications only
  expect(port.registrationGeneration()).toBe(1);
  await port.set("sample", false);
  expect(port.registrations()).toEqual([]);
  expect(signals).toEqual([1, 2]);
  life.abort();
});

test("a superseded load's completion never publishes over the newer load (off and on between finishing and its follow-up)", async () => {
  const life = new AbortController(), src = sources();
  const resolvers: ((value: unknown) => void)[] = [];
  const loaded = { ...definition, load: async () => ({ create: () => new Promise(resolve => { resolvers.push(resolve); }) as never }) };
  const port = await createExperiments({ definitions: [loaded], overrides: {}, ...src, signal: life.signal });
  await port.set("sample", true);
  for (let i = 0; i < 50 && !resolvers.length; i++) await Promise.resolve();
  resolvers[0]!({ module: { id: "sample" }, service: { subscribe: () => () => {} } });
  // Step one microtask at a time to the window: the first load is done (registered) but its follow-up hasn't run yet.
  let window = false;
  for (let i = 0; i < 50 && !window; i++) { await Promise.resolve(); window = port.registrations().length === 1 && port.snapshot()[0]!.phase === "loading"; }
  expect(window).toBe(true);
  await port.set("sample", false); await port.set("sample", true);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(port.snapshot()[0]!.phase).toBe("loading"); // the newer load is still pending; the old one didn't mark it ready
  expect(port.registrations()).toEqual([]);
  life.abort();
});

test("a registration listener that switches the experiment off and on as it registers never lets the old load mark the new one ready", async () => {
  const life = new AbortController(), src = sources();
  let loadsMade = 0;
  const pending = new Promise<never>(() => {});
  const loaded = { ...definition, load: async () => ({ create: () => (++loadsMade === 1 ? { module: { id: "sample" }, service: { subscribe: () => () => {} } } : pending) as never }) };
  const port = await createExperiments({ definitions: [loaded], overrides: {}, ...src, signal: life.signal });
  let flipped = false;
  port.onRegistrationsChanged(() => { if (!flipped) { flipped = true; void port.set("sample", false); void port.set("sample", true); } });
  await port.set("sample", true);
  for (let i = 0; i < 50 && !flipped; i++) await new Promise(resolve => setTimeout(resolve, 2));
  expect(flipped).toBe(true);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(loadsMade).toBe(2);
  expect(port.snapshot()[0]!.phase).toBe("loading"); // the newer load is pending; the old continuation published nothing after it
  expect(port.registrations()).toEqual([]);
  life.abort();
});

test("a registration listener that switches the experiment back on as it switches off leaves the new load's phase standing", async () => {
  const life = new AbortController(), src = sources();
  let loadsMade = 0;
  const loaded = { ...definition, load: async () => ({ create: () => (++loadsMade === 1 ? { module: { id: "sample" }, service: { subscribe: () => () => {} } } : new Promise(() => {})) as never }) };
  const port = await createExperiments({ definitions: [loaded], overrides: {}, ...src, signal: life.signal });
  await port.set("sample", true);
  for (let i = 0; i < 50 && !port.registrations().length; i++) await new Promise(resolve => setTimeout(resolve, 2));
  let reopened = false;
  port.onRegistrationsChanged(() => { if (!reopened && !port.registrations().length) { reopened = true; void port.set("sample", true); } });
  await port.set("sample", false);
  expect(reopened).toBe(true);
  expect(port.snapshot()[0]!.enabled).toBe(true);
  expect(port.snapshot()[0]!.phase).toBe("loading"); // not overwritten with "off"
  life.abort();
});

test("the started port forwards registration events to each listener on its own: a throwing one is reported, the others hear", async () => {
  const life = new AbortController(), src = sources(), reported: unknown[] = [];
  const loaded = { ...definition, load: async () => ({ create: () => ({ module: { id: "sample" }, service: { subscribe: () => () => {} } }) as never }) };
  const port = startExperiments({ definitions: [loaded], overrides: {}, ...src, signal: life.signal, report: error => reported.push(error) });
  let heard = 0;
  port.onRegistrationsChanged(() => { throw Error("listener broke"); });
  port.onRegistrationsChanged(() => { heard++; });
  expect(await port.ready).toBe(true);
  await port.set("sample", true);
  for (let i = 0; i < 50 && !port.registrations().length; i++) await new Promise(resolve => setTimeout(resolve, 2));
  await port.set("sample", false);
  expect(heard).toBe(2);
  expect(reported).toHaveLength(2);
  expect(port.snapshot()[0]!.phase).toBe("off");
  life.abort();
});

test("a registration listener that throws is reported, the others still hear, and switching off completes", async () => {
  const life = new AbortController(), src = sources(), reported: unknown[] = [];
  const loaded = { ...definition, load: async () => ({ create: () => ({ module: { id: "sample" }, service: { subscribe: () => () => {} } }) as never }) };
  const port = await createExperiments({ definitions: [loaded], overrides: {}, ...src, signal: life.signal, report: error => reported.push(error) });
  let heard = 0;
  port.onRegistrationsChanged(() => { throw Error("listener broke"); });
  port.onRegistrationsChanged(() => { heard++; });
  await port.set("sample", true);
  for (let i = 0; i < 50 && !port.registrations().length; i++) await new Promise(resolve => setTimeout(resolve, 2));
  await port.set("sample", false);
  expect(heard).toBe(2);
  expect(reported).toHaveLength(2);
  expect(port.snapshot()[0]!.phase).toBe("off");
  expect(port.snapshot()[0]!.enabled).toBe(false);
  life.abort();
});
