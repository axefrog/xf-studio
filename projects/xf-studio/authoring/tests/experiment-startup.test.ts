import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createExperiments, startExperiments } from "../src/platform/core/experiments";
import { EXPERIMENT_FLAGS } from "../src/platform/api/experiments";
import type { DocumentStorePort } from "../src/platform/api/document-store";
import { seededRandom } from "../src/platform/core/random";
import { storeDocuments } from "./fixtures/platform-doubles";
const sources = () => ({ random: seededRandom(29) });
const definition = { id: "sample", label: "Sample", description: "Test", load: async () => { throw Error("must stay off"); } };

test("experimental store failure never blocks synchronous all-off startup", async () => {
  const life = new AbortController(), documents: DocumentStorePort = { list: async () => { throw Error("store unavailable"); }, put: async () => { throw Error("store unavailable"); } };
  const port = startExperiments({ definitions: [definition], overrides: {}, ...sources(), documents, signal: life.signal });
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
  const port = await createExperiments({ definitions: [definition], overrides: {}, ...sources(), documents, signal: life.signal });
  expect(documents.store.list(EXPERIMENT_FLAGS.kind)).toEqual([]);
  await port.set("sample", false); await port.set("sample", false);
  const stored = documents.store.list(EXPERIMENT_FLAGS.kind);
  expect(stored.map(item => [item.id, item.revision])).toEqual([[EXPERIMENT_FLAGS.id, 2]]);
  expect(stored[0].value).toEqual({ schema: EXPERIMENT_FLAGS.schema, flags: { sample: false } }); life.abort();
});

test("quick successive sets are saved in order and the newest wins", async () => {
  const life = new AbortController(), documents = storeDocuments();
  const port = await createExperiments({ definitions: [{ ...definition, id: "a" }, { ...definition, id: "b" }], overrides: {}, ...sources(), documents, signal: life.signal });
  const results = await Promise.all([port.set("a", false), port.set("b", false), port.set("a", false)]);
  expect(results.every(result => result.ok)).toBe(true);
  expect((documents.store.get(EXPERIMENT_FLAGS.kind, EXPERIMENT_FLAGS.id)!.value as { flags: unknown }).flags).toEqual({ a: false, b: false }); life.abort();
});

test("a lost save acknowledgement never rolls accepted preferences back behind the store", async () => {
  const life = new AbortController(), documents = storeDocuments();
  let lose = true;
  const flaky: DocumentStorePort = { list: documents.list, put: async (...args) => { const written = await documents.put(...args); if (lose) throw Error("acknowledgement lost"); return written; } };
  const loaded = { ...definition, load: async () => ({ create: () => ({ service: { subscribe: () => () => {} } }) as never }) };
  const port = await createExperiments({ definitions: [loaded], overrides: {}, ...sources(), documents: flaky, signal: life.signal });
  expect((await port.set("sample", true)).ok).toBe(false); expect(port.snapshot()[0].enabled).toBe(true); expect(port.snapshot()[0].message).toContain("confirm");
  expect((documents.store.get(EXPERIMENT_FLAGS.kind, EXPERIMENT_FLAGS.id)!.value as { flags: unknown }).flags).toEqual({ sample: true });
  lose = false; expect((await port.set("sample", true)).ok).toBe(true); expect(port.snapshot()[0].enabled).toBe(true); expect(port.snapshot()[0].message).toBe(""); life.abort();
  const nextLife = new AbortController(), next = await createExperiments({ definitions: [definition], overrides: {}, ...sources(), documents, signal: nextLife.signal });
  expect(next.snapshot()[0].enabled).toBe(true); nextLife.abort();
});
