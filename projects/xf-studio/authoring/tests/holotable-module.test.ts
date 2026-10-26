import { describe, expect, test } from "bun:test";
import { createHolotable, type HoloTransport } from "../src/features/holotable";
import { createHolotableHandler, type HolotableSpawner } from "../src/features/holotable/host/holotable-server";
import { clipToRect, ORBITS, project, trail } from "../src/features/holotable/view/projection";
import type { HoloSession } from "../src/features/holotable/types";

const session = (level: "structure" | "full"): HoloSession => ({
  meta: { session: "s1", run: 1, start: 100, end: 110, from: 100, to: 110, channels: ["v"], complete: true, dropped: 0, missedDeadlines: 0, largestGapS: 0.1, coverage: "test", problems: [] },
  v: Array.from({ length: 101 }, (_, i) => ({ t: 100 + i * 0.1, seq: i + 1, position: [i, 0, 10] as const, yaw: 0, speed: 1, health: 100, healthMax: 100, inCombat: false, vehicle: false, busy: "" })),
  camera: [{ t: 100, seq: 1, position: [0, -5, 12], forward: [0, 1, 0], up: [0, 0, 1], fov: 40, aspect: 1.8 }],
  events: [{ id: "e1", kind: "line", t: 101, seq: 9, summary: "Line spoken", ...(level === "full" ? { detail: "Someone: hello" } : {}), level: "full", cite: "recorder:s1:1:9" },
    { id: "e2", kind: "supervisor.safe_position", t: 102, seq: 20, at: [20, 0, 10], summary: "Safe point", level: "structure", cite: "recorder:s1:1:20" }],
  gaps: [{ from: 100 + 4 * 0.1, to: 100 + 6 * 0.1, reason: "time" }],
});

function fakeTransport(log: string[] = []): HoloTransport {
  return async (method, params) => {
    log.push(`${method}:${params.level ?? ""}`);
    const result = method === "runs.list" ? [{ session: "s1", run: 1, dir: "D1", start: 100, end: 110, bytes: 1, complete: true }]
      : method === "session.open" ? session(params.level as "structure" | "full") : { provenance: null, areas: [], cells: [] };
    return { ok: true, status: 200, data: { ok: true, result } };
  };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("Holotable service", () => {
  test("a cold open announces the city read and a newer recording cancels that read", async () => {
    let firstSignal!: AbortSignal, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), base = fakeTransport();
    const transport: HoloTransport = async (method, params, signal) => {
      if (method === "runs.list") return { ok: true, status: 200, data: { ok: true, result: ["D1", "D2"].map(dir => ({ session: "s1", run: 1, dir, start: 100, end: 110, bytes: 1, complete: true })) } };
      if (method === "world.status") return { ok: true, status: 200, data: { ok: true, result: { cold: params.dir === "D1" } } };
      if (method === "world.around" && params.dir === "D1") { firstSignal = signal; await gate; signal.throwIfAborted(); }
      return base(method, params, signal);
    };
    const service = createHolotable({ transport }, new AbortController().signal);
    service.shown(); await flush(); const first = service.dispatch({ kind: "holo.open", dir: "D1" }); await flush();
    expect(service.snapshot().message).toBe("Reading the city around this recording from the game files… This happens once.");
    await service.dispatch({ kind: "holo.open", dir: "D2" }); expect(firstSignal.aborted).toBe(true);
    release(); await first; expect(service.snapshot().open?.dir).toBe("D2"); expect(service.snapshot().phase).toBe("ready");
  });
  test("lists recordings only when first shown, then opens one at the start", async () => {
    const log: string[] = [];
    const service = createHolotable({ transport: fakeTransport(log) }, new AbortController().signal);
    expect(log).toEqual([]);
    service.shown(); await flush();
    expect(service.snapshot().runs.map(r => r.dir)).toEqual(["D1"]);
    expect((await service.dispatch({ kind: "holo.open", dir: "D1" })).ok).toBe(true);
    expect(service.snapshot().t).toBe(100);
    expect(service.snapshot().phase).toBe("ready");
  });

  test("story content is fetched at the level asked for and dropped again", async () => {
    const log: string[] = [];
    const service = createHolotable({ transport: fakeTransport(log) }, new AbortController().signal);
    service.shown(); await flush();
    await service.dispatch({ kind: "holo.open", dir: "D1" });
    expect(service.snapshot().level).toBe("full");
    expect(JSON.stringify(service.snapshot().open)).toContain("hello");
    await service.dispatch({ kind: "holo.level", level: "full" });
    expect(JSON.stringify(service.snapshot().open)).toContain("hello");
    await service.dispatch({ kind: "holo.level", level: "structure" });
    expect(JSON.stringify(service.snapshot().open)).not.toContain("hello");
  });

  test("seeking clamps to the recording and stops playback; playback ends at the end", async () => {
    let tick: (() => void) | null = null;
    const service = createHolotable({ transport: fakeTransport(), every: (_ms, fn) => { tick = fn; return () => { tick = null; }; } }, new AbortController().signal);
    service.shown(); await flush();
    await service.dispatch({ kind: "holo.open", dir: "D1" });
    await service.dispatch({ kind: "holo.seek", t: 500 });
    expect(service.snapshot().t).toBe(110);
    await service.dispatch({ kind: "holo.play", on: true });
    expect(service.snapshot().t).toBe(100);
    for (let i = 0; i < 100 && tick; i++) (tick as () => void)();
    expect(service.snapshot().t).toBe(110);
    expect(service.snapshot().playing).toBe(false);
  });

  test("a switch back to hidden story content supersedes a switch to shown that is still loading", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const base = fakeTransport();
    let delayFull = false;
    const slowFull: HoloTransport = async (method, params, signal) => {
      if (delayFull && method === "session.open" && params.level === "full") { await gate; signal.throwIfAborted(); }
      return base(method, params, signal);
    };
    const service = createHolotable({ transport: slowFull }, new AbortController().signal);
    service.shown(); await flush();
    await service.dispatch({ kind: "holo.open", dir: "D1" });
    await service.dispatch({ kind: "holo.level", level: "structure" });
    delayFull = true;
    const toFull = service.dispatch({ kind: "holo.level", level: "full" });
    await service.dispatch({ kind: "holo.level", level: "structure" });
    release(); await toFull; await flush();
    expect(service.snapshot().level).toBe("structure");
    expect(JSON.stringify(service.snapshot().open)).not.toContain("hello");
  });

  test("Play twice keeps one timer; Pause stops it", async () => {
    let timers = 0;
    const service = createHolotable({ transport: fakeTransport(), every: () => { timers++; return () => { timers--; }; } }, new AbortController().signal);
    service.shown(); await flush();
    await service.dispatch({ kind: "holo.open", dir: "D1" });
    await service.dispatch({ kind: "holo.play", on: true });
    await service.dispatch({ kind: "holo.play", on: true });
    expect(timers).toBe(1);
    await service.dispatch({ kind: "holo.play", on: false });
    expect(timers).toBe(0);
  });

  test("refuses with a reason before a recording is open", () => {
    const service = createHolotable({ transport: null }, new AbortController().signal);
    expect(service.capability({ kind: "holo.play", on: true }).available).toBe(false);
    expect(service.capability({ kind: "holo.refresh" }).reason).toContain("isn't available");
  });
});

describe("Holotable projection", () => {
  test("the trail breaks at a gap and never draws through it", () => {
    expect(trail(session("structure"), 110).length).toBe(2);
  });
  test("projects V, the placed event and a true scale bar", () => {
    const layers = { v: true, camera: true, events: true, gaps: true, areas: true, cells: true, solids: true };
    const scene = project(session("structure"), { provenance: null, areas: [], cells: [] }, 105, layers, ORBITS.tilt, 800, 500, "e2");
    expect(scene.v?.position[0]).toBe(50);
    expect(scene.primitives.some(p => p.kind === "marker" && p.id === "v")).toBe(true);
    expect(scene.primitives.some(p => p.kind === "marker" && p.id === "e2" && p.style === "event-selected")).toBe(true);
    expect(scene.barPx).toBeLessThanOrEqual(140);
    expect([5, 10, 20, 50, 100, 200, 500]).toContain(scene.metresPerBar);
  });
  test("clipping keeps what is inside, cuts at the edges, breaks the run where a line leaves, and drops what misses", () => {
    expect(clipToRect([[10, 10], [50, 10], [50, 50]], 0, 0, 100, 100)).toEqual([{ points: [[10, 10], [50, 10], [50, 50]], offset: 0 }]);
    expect(clipToRect([[-100, 50], [200, 50]], 0, 0, 100, 100)).toEqual([{ points: [[0, 50], [100, 50]], offset: 100 }]);
    // Out through the right edge and back in: two runs, each ending on the edge; the second starts 100 + 60 + 50 px along.
    expect(clipToRect([[50, 20], [150, 20], [150, 80], [50, 80]], 0, 0, 100, 100)).toEqual([{ points: [[50, 20], [100, 20]], offset: 0 }, { points: [[100, 80], [50, 80]], offset: 210 }]);
    expect(clipToRect([[-50, -50], [-10, 200]], 0, 0, 100, 100)).toEqual([]);
  });
  test("no line runs far past the drawing: a district outline around the camera stays within the margin", () => {
    // A district much larger than the view, centred on V: unclipped, its near edges project millions of pixels away.
    const big = { kind: "district" as const, name: "Big", poly: [[-5000, -5000], [5000, -5000], [5000, 5000], [-5000, 5000]] as [number, number][], zlo: 0, zhi: 400 };
    const layers = { v: true, camera: true, events: true, gaps: true, areas: true, cells: false, solids: true };
    for (const orbit of Object.values(ORBITS)) {
      const scene = project(session("structure"), { provenance: null, areas: [big as never], cells: [] }, 105, layers, orbit, 800, 500, null);
      for (const p of scene.primitives) if (p.kind === "line") for (const [x, y] of p.points) {
        expect(x).toBeGreaterThanOrEqual(-32.001); expect(x).toBeLessThanOrEqual(832.001);
        expect(y).toBeGreaterThanOrEqual(-32.001); expect(y).toBeLessThanOrEqual(532.001);
      }
    }
  });
});

describe("Holotable host endpoint", () => {
  const post = (body: unknown, signal?: AbortSignal, host = "127.0.0.1") => new Request(`http://${host}/api/holotable`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  function fakeSpawner(counter: { spawned: number; killed: number; sent: string[] }): HolotableSpawner {
    return (_script, onLine) => {
      counter.spawned++;
      let resolveExit!: (code: number) => void;
      const exited = new Promise<number>(resolve => { resolveExit = resolve; });
      return {
        send(line) { counter.sent.push(line); const req = JSON.parse(line); if (req.method !== "cancel" && req.method !== "slow") queueMicrotask(() => onLine(JSON.stringify({ id: req.id, ok: true, result: req.method }))); },
        exited, kill() { counter.killed++; resolveExit(0); },
      };
    };
  }

  test("spawns nothing until the first request, then shares one child", async () => {
    const counter = { spawned: 0, killed: 0, sent: [] as string[] };
    const handler = createHolotableHandler({ script: import.meta.path, spawn: fakeSpawner(counter), idleMs: 60_000 });
    expect(counter.spawned).toBe(0);
    const [a, b] = await Promise.all([handler.handle(post({ method: "runs.list" })), handler.handle(post({ method: "service.info" }))]);
    expect(await a.json()).toEqual({ ok: true, result: "runs.list" });
    expect(b.status).toBe(200);
    expect(counter.spawned).toBe(1);
    handler.dispose();
    expect(counter.killed).toBe(1);
  });

  test("answers 404 and spawns nothing where the service isn't shipped", async () => {
    const counter = { spawned: 0, killed: 0, sent: [] as string[] };
    const handler = createHolotableHandler({ script: "Z:/missing/service.ts", spawn: fakeSpawner(counter) });
    expect((await handler.handle(post({ method: "runs.list" }))).status).toBe(404);
    expect(counter.spawned).toBe(0);
  });

  test("a cancelled request tells the service and answers 499", async () => {
    const counter = { spawned: 0, killed: 0, sent: [] as string[] };
    const handler = createHolotableHandler({ script: import.meta.path, spawn: fakeSpawner(counter), idleMs: 60_000 });
    const ctl = new AbortController();
    const pending = handler.handle(post({ method: "slow" }, ctl.signal));
    await flush(); ctl.abort();
    expect((await pending).status).toBe(499);
    expect(counter.sent.some(line => JSON.parse(line).method === "cancel")).toBe(true);
    handler.dispose();
  });

  test("refuses other host names, other origins and non-JSON before spawning", async () => {
    const counter = { spawned: 0, killed: 0, sent: [] as string[] };
    const handler = createHolotableHandler({ script: import.meta.path, spawn: fakeSpawner(counter) });
    expect((await handler.handle(post({ method: "runs.list" }, undefined, "evil.example"))).status).toBe(403);
    const crossSite = new Request("http://127.0.0.1/api/holotable", { method: "POST", headers: { "content-type": "application/json", Origin: "http://evil.example" }, body: "{}" });
    expect((await handler.handle(crossSite)).status).toBe(403);
    const form = new Request("http://127.0.0.1/api/holotable", { method: "POST", headers: { "content-type": "text/plain" }, body: '{"method":"runs.list"}' });
    expect((await handler.handle(form)).status).toBe(415);
    expect(counter.spawned).toBe(0);
  });

  test("an old child's late exit fails only its own requests", async () => {
    const exits: (() => void)[] = [];
    let held = 0;
    const spawn: HolotableSpawner = (_script, onLine) => {
      let resolveExit!: (code: number) => void;
      const exited = new Promise<number>(resolve => { resolveExit = resolve; });
      exits.push(() => resolveExit(0));
      return { send(line) { const req = JSON.parse(line); if (req.method === "hold") { held++; return; } queueMicrotask(() => onLine(JSON.stringify({ id: req.id, ok: true, result: req.method }))); }, exited, kill() { /* exits later */ } };
    };
    const handler = createHolotableHandler({ script: import.meta.path, spawn, idleMs: 60_000 });
    await handler.handle(post({ method: "runs.list" }));
    handler.dispose(); // the first child is told to stop but hasn't exited yet
    const second = handler.handle(post({ method: "hold" }));
    await flush();
    exits[0](); await flush();
    expect(held).toBe(1);
    let settled = false; void second.then(() => { settled = true; }); await flush();
    expect(settled).toBe(false);
    exits[1](); expect((await second).status).toBe(502);
  });

  test("stops the child after the idle time", async () => {
    const counter = { spawned: 0, killed: 0, sent: [] as string[] };
    const handler = createHolotableHandler({ script: import.meta.path, spawn: fakeSpawner(counter), idleMs: 5 });
    await handler.handle(post({ method: "runs.list" }));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(counter.killed).toBe(1);
    handler.dispose();
  });
});
