import { expect, test } from "bun:test";
import { createModuleServices } from "../src/compose/module-services";
import { PoseLibraryActions, type PoseLibraryDevice, type PoseStage } from "../src/features/poses";
import { browserPoseTransport } from "../src/animation/browser/browser-pose-device";

const preparing = () => ({ ok: true, status: 200, data: { schema: "xfs/pose-catalogue-state-1", phase: "preparing", message: "Reading poses…" } });
// Flush the fixed promise chain without advancing the fake clock.
async function settled() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

function stage() {
  let gender: "female" | "male" = "female";
  const listeners = new Set<() => void>();
  const port: PoseStage = { view: () => "main", bodyGender: () => gender, wornTags: () => [], motion: () => null,
    frame: () => ({ available: true }), frameCapability: () => ({ available: true }),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { port, listeners, change: () => { gender = "male"; for (const listener of listeners) listener(); } };
}

async function withTimers(run: (timers: Map<number, () => void>) => Promise<void>) {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = { setTimeout: globals.setTimeout, clearTimeout: globals.clearTimeout };
  const timers = new Map<number, () => void>();
  let id = 0;
  globals.setTimeout = (callback: () => void, ms: number) => { expect(ms).toBe(700); timers.set(++id, callback); return id; };
  globals.clearTimeout = (handle: number) => timers.delete(handle);
  try { await run(timers); } finally { Object.assign(globals, previous); }
}

test("application abort clears the pose module's 700 ms poll and its stage subscription immediately", () => withTimers(async timers => {
  const life = new AbortController(), shown = stage();
  const signals: AbortSignal[] = [];
  const device: PoseLibraryDevice = { preferences: null, catalogue: async (_request, options) => { signals.push(options!.signal!); return preparing(); } };
  try {
    createModuleServices({ saves: null, poses: { device, stage: shown.port } }, ["poses"], life.signal);
    await settled();
    expect(timers.size).toBe(1);
    // The host can remain preparing through several polls; there is only one pending wait.
    for (let i = 0; i < 3; i++) {
      const [id, run] = [...timers][0]!; timers.delete(id); run(); await settled(); expect(timers.size).toBe(1);
    }
    life.abort();
    expect(timers.size).toBe(0);
    expect(shown.listeners.size).toBe(0);
    expect(signals).toHaveLength(4);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    shown.change(); await settled();
    expect(signals).toHaveLength(4);
    expect(timers.size).toBe(0);
  } finally { life.abort(); }
}));

test("a late, non-cancellable pose reply cannot restart polling after application release", () => withTimers(async timers => {
  const life = new AbortController(), shown = stage(), reply = Promise.withResolvers<ReturnType<typeof preparing>>();
  let requests = 0;
  try {
    createModuleServices({ saves: null, poses: { device: { preferences: null, catalogue: async () => { requests++; return reply.promise; } }, stage: shown.port } }, ["poses"], life.signal);
    life.abort(); reply.resolve(preparing()); await settled();
    expect(requests).toBe(1);
    expect(timers.size).toBe(0);
    expect(shown.listeners.size).toBe(0);
  } finally { life.abort(); }
}));

test("release from a pose publication does not schedule a wait on an already aborted signal", () => withTimers(async timers => {
  const life = new AbortController();
  const actions = new PoseLibraryActions({ preferences: null, catalogue: async () => preparing() }, stage().port, life.signal);
  actions.subscribe(() => life.abort());
  try { await settled(); expect(life.signal.aborted).toBe(true); expect(timers.size).toBe(0); }
  finally { actions.dispose(); }
}));

test("a new body cancels the old pose wait; direct disposal and pre-aborted construction leave no timers", () => withTimers(async timers => {
  const life = new AbortController(), shown = stage(), signals: AbortSignal[] = [];
  const device: PoseLibraryDevice = { preferences: null, catalogue: async (_request, options) => { signals.push(options!.signal!); return preparing(); } };
  const actions = new PoseLibraryActions(device, shown.port, life.signal);
  try {
    await settled(); expect(timers.size).toBe(1);
    shown.change(); expect(timers.size).toBe(0); await settled(); expect(timers.size).toBe(1);
    expect(signals[0]!.aborted).toBe(true); expect(signals[1]!.aborted).toBe(false);
    actions.dispose(); expect(timers.size).toBe(0); expect(signals[1]!.aborted).toBe(true);
    life.abort();
    new PoseLibraryActions(device, shown.port, life.signal); await settled();
    expect(signals).toHaveLength(2); expect(timers.size).toBe(0); expect(shown.listeners.size).toBe(0);
  } finally { actions.dispose(); life.abort(); }
}));

test("the browser pose transport forwards the lifetime signal to fetch", async () => {
  const previous = globalThis.fetch, life = new AbortController();
  globalThis.fetch = (async (_input: unknown, options?: RequestInit) => {
    expect(options?.signal).toBe(life.signal);
    return Response.json(preparing().data);
  }) as typeof fetch;
  try { await browserPoseTransport({ method: "GET", query: { gender: "female" } }, { signal: life.signal }); }
  finally { globalThis.fetch = previous; life.abort(); }
});
