import { expect, test } from "bun:test";
import { FacialPreview, type FacialDevicePort, type FacialSolved, type FacialTimer } from "../src/animation/facial-preview";
import { createBrowserFacialDevice } from "../src/animation/browser/browser-facial-device";
import { FACIAL_STATE_SCHEMA, type FacialHostState, type FacialStartPoints } from "../src/platform/api/facial";

const deferred = <T>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve }; };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const ready: FacialHostState = { schema: FACIAL_STATE_SCHEMA, rig: { phase: "ready", controls: [],
  joints: [{ name: "root", parent: -1, t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }] }, solver: { phase: "ready" },
  expressions: { phase: "ready", count: 0 }, blink: { available: false }, samples: [] };

for (const pending of ["state", "expressions", "solve", "prefetch"] as const) test(`facial owner aborts ${pending}, clears timers and refuses a non-cancellable late reply`, async () => {
  const state = deferred<FacialHostState>(), points = deferred<FacialStartPoints>(), solved = deferred<FacialSolved>();
  const signals: AbortSignal[] = [], timers = new Map<number, () => void>(); let id = 0;
  const timer: FacialTimer = { now: () => 0, set: run => { timers.set(++id, run); return id; }, clear: id => { timers.delete(id as number); } };
  const device: FacialDevicePort = {
    state: async signal => { signals.push(signal!); return pending === "state" ? state.promise : ready; },
    expressions: async (_options, signal) => { signals.push(signal!); return points.promise; },
    solve: async (_request, signal) => { signals.push(signal!); return solved.promise; },
  };
  const preview = new FacialPreview(device, timer); let publications = 0, holds = 0, rigs = 0;
  preview.subscribe(() => { publications++; });
  if (pending === "expressions") preview.installed(); else preview.start();
  await settle();
  if (pending === "prefetch") preview.prefetch();
  if (pending === "solve") { preview.attachScene({ setRig: () => { rigs++; }, hold: () => { holds++; }, release() {} }); preview.follow(() => ({ jaw: .3 }), () => undefined); }
  const before = { publications, holds, rigs };
  preview.dispose(); preview.dispose();
  const retired = preview.snapshot();
  expect(signals.length).toBeGreaterThan(0); expect(signals.every(signal => signal.aborted)).toBe(true); expect(timers.size).toBe(0);
  state.resolve(ready); points.resolve({ phase: "ready", items: [] }); solved.resolve({ ok: true, frames: 1, ms: 1, skipped: [], pose: { q: new Float32Array([0, 0, 0, 1]), t: new Float32Array(3) } });
  await settle();
  preview.retry(); preview.start(); preview.installed(); preview.prefetch(); preview.changed();
  expect({ publications, holds, rigs }).toEqual(before); expect(preview.snapshot()).toEqual(retired);
  expect(timers.size).toBe(0);
});

for (const method of ["state", "expressions", "solve"] as const) test(`facial HTTP ${method} checks cancellation after a late body before decoding`, async () => {
  const body = deferred<unknown>(), life = new AbortController();
  const requests: { url: string; init?: RequestInit }[] = [];
  const device = createBrowserFacialDevice(async (url, init) => { requests.push({ url, init });
    return { ok: true, json: () => body.promise } as Response; });
  const response = method === "state" ? device.state(life.signal) : method === "expressions" ? device.expressions({ prefetch: true }, life.signal)
    : device.solve({ controls: { jaw: .2 } }, life.signal);
  const outcome = response.then(() => null, error => error as Error);
  await settle(); life.abort(); body.resolve({ ok: true, q: "invalid", t: "invalid" });
  expect(await outcome).toMatchObject({ name: "AbortError" });
  expect(requests).toHaveLength(1); expect(requests[0]!.init?.signal).toBe(life.signal);
  if (method === "expressions") expect(requests[0]!.url).toEndWith("?prefetch=1");
  if (method === "solve") expect(JSON.parse(String(requests[0]!.init?.body))).toMatchObject({ controls: { jaw: .2 }, client: expect.any(String) });
});
