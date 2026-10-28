import { expect, spyOn, test } from "bun:test";
import { profileContextStudio } from "./fixtures/profile-context-studio";
import { eyeCheck } from "./fixtures/package-results";

const tick = () => new Promise(resolve => setTimeout(resolve, 1));
async function until(ready: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!ready() && Date.now() < deadline) await tick();
  expect(ready()).toBe(true);
}

test("application abort cancels a detached Check transport, releases captures and publishes no late outcome", async () => {
  const life = new AbortController(), gate = Promise.withResolvers<void>();
  let signal: AbortSignal | undefined, input: unknown;
  const s = await profileContextStudio({ signal: life.signal, package: async (_action, collection, abort) => {
    signal = abort; input = collection; await gate.promise; return eyeCheck(collection as { id: string }, { presets: [] });
  } });
  const bound = s.bind("presets--scene0"), port = bound.context.current();
  const pending = port.files.execute({ kind: "package.check" });
  try {
    await until(() => !!signal); bound.life.abort();
    expect(signal?.aborted).toBe(false); expect(s.targets.held()).toBeGreaterThan(0);
    life.abort(); expect(await pending).toMatchObject({ ok: false, code: "missing_target" });
    expect(signal?.aborted).toBe(true); expect(s.targets.held()).toBe(0); expect(input).toBeDefined();
    const state = port.files.snapshot(); gate.resolve(); await tick();
    expect(port.files.snapshot()).toEqual(state);
  } finally { life.abort(); gate.resolve(); await pending; await s.dispose(); }
});

test("application abort while a captured package snapshot waits starts no later host work", async () => {
  const life = new AbortController(), gate = Promise.withResolvers<void>(); let calls = 0, waiting = false;
  const s = await profileContextStudio({ signal: life.signal, package: async (_action, input) => { calls++; return eyeCheck(input as { id: string }, { presets: [] }); } });
  const original = s.services.collections.snapshot.bind(s.services.collections);
  const delayed = spyOn(s.services.collections, "snapshot").mockImplementation(async (...args) => { waiting = true; await gate.promise; return original(...args); });
  const bound = s.bind("presets--scene0"), pending = bound.context.current().files.execute({ kind: "package.check" });
  try {
    await until(() => waiting); life.abort(); expect(await pending).toMatchObject({ ok: false, code: "missing_target" });
    expect(s.targets.held()).toBe(0); gate.resolve(); await tick(); expect(calls).toBe(0);
  } finally { gate.resolve(); delayed.mockRestore(); await pending; await s.dispose(); }
});
