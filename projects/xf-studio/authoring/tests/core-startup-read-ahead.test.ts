import { expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { CORE_TEXTURE_SLOTS, type CoreDetail } from "../src/character/render-detail";
import { createBrowserViewportDevice } from "../src/preview/browser/browser-viewport-device";
import * as scenes from "../src/platform/scene/scene-host";
import { readMotionAhead } from "../src/platform/scene/motion-read-ahead";
import { releaseCoreDetailFiles, startCoreDetail } from "../src/character/render/core-detail-loader";
import { startGameMotion } from "../src/platform/scene/head-rig";
import * as THREE from "three";

const bytes = Buffer.from("synthetic core bytes"), sha256 = createHash("sha256").update(bytes).digest("hex");
const record: CoreDetail = { schema: "xfs/render-detail-1", detail: "core-head", identity: "synthetic", origin: "game-files",
  provenance: { label: "Synthetic core", notes: [] }, geometry: { file: "head.glb", sha256, sources: [], nodes: { head: "head", eyes: "eyes" }, morphs: [] },
  textures: Object.fromEntries(CORE_TEXTURE_SLOTS.map(slot => [slot, { file: slot.replace(".", "-") + ".png", sha256, sources: [] }])) as CoreDetail["textures"] };

test.each([false, true])("core record and motion reads precede renderer initialization; cancelled=%s", async cancel => {
  const realFetch = globalThis.fetch, reply = Promise.withResolvers<Response>(), calls: string[] = [], signals: AbortSignal[] = [];
  const life = new AbortController();
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(url); signals.push(init!.signal!);
    if (url.endsWith("preview-core.json")) return reply.promise;
    return url.startsWith("/api/") ? Response.json({}, { status: 404 }) : new Response(bytes);
  }, { preconnect: realFetch.preconnect });
  let devices = 0;
  const viewer = {} as scenes.SceneRuntime;
  const scene = spyOn(scenes, "createSceneRuntime").mockImplementation(async (_device, options) => {
    expect(options?.loadCore).toBeFunction(); expect(options?.loadMotion).toBeFunction(); return viewer;
  });
  const viewport = createBrowserViewportDevice({ signal: life.signal, headHost: {} as HTMLElement, window: new EventTarget(),
    queryContext: () => { throw Error("No hit"); }, deviceFactory: (() => {
      devices++;
      expect(calls).toContain("/assets/head.glb");
      for (const texture of Object.values(record.textures)) expect(calls).toContain(`/assets/${texture.file}`);
      return { dispose() {}, show() {} };
    }) as never });
  const build = viewport.buildHead();
  try {
    expect(calls).toEqual(["/assets/preview-core.json", "/api/facial/blink", "/api/idles"]);
    expect(devices).toBe(0);
    if (cancel) life.abort();
    reply.resolve(Response.json(record));
    if (cancel) { await expect(build).rejects.toMatchObject({ name: "AbortError" }); expect(devices).toBe(0); expect(scene).not.toHaveBeenCalled(); }
    else { expect(await build).toBe(viewer); expect(devices).toBe(1); }
    viewport.dispose();
    expect(signals.every(signal => signal.aborted)).toBe(true);
  } finally { life.abort(); viewport.dispose(); scene.mockRestore(); globalThis.fetch = realFetch; }
});

test("motion read-ahead asks for the catalogue, blink and default body once; subsequent catalogue polls are fresh", async () => {
  const life = new AbortController(), bodyAsked = Promise.withResolvers<void>(), calls: string[] = [];
  const catalogue = { schema: "xfs/idle-state-1", phase: "ready", source: "game", catalogue: { idles: [{ id: "other" }, { id: "closeup" }] } };
  const read = readMotionAhead("female", life.signal, async url => {
    calls.push(url);
    if (url.includes("?body=")) bodyAsked.resolve();
    return Response.json(catalogue);
  });
  try {
    expect(calls).toEqual(["/api/facial/blink", "/api/idles"]);
    await (await read("/api/idles")).json();
    await bodyAsked.promise;
    await read("/api/idles?body=closeup"); await read("/api/facial/blink");
    expect(calls.filter(url => url.includes("?body="))).toEqual(["/api/idles?body=closeup"]);
    expect(calls.filter(url => url === "/api/facial/blink")).toHaveLength(1);
    await read("/api/idles");
    expect(calls.filter(url => url === "/api/idles")).toHaveLength(2);
    life.abort(); expect(() => read("/api/idles")).toThrow();
  } finally { life.abort(); }
});

test("a late catalogue after release sends no body request; the masculine head preloads only its existing blink path", async () => {
  const life = new AbortController(), reply = Promise.withResolvers<Response>(), calls: string[] = [];
  readMotionAhead("female", life.signal, async (url, init) => {
    expect(init?.signal).toBe(life.signal); calls.push(url);
    return url === "/api/idles" ? reply.promise : Response.json({});
  });
  life.abort(); reply.resolve(Response.json({ schema: "xfs/idle-state-1", phase: "ready", source: "game", catalogue: { idles: [{ id: "closeup" }] } }));
  await new Promise<void>(resolve => setImmediate(resolve)); // Let the late JSON continuation run before checking it sent nothing.
  const male = new AbortController();
  try { readMotionAhead("male", male.signal, async url => { calls.push(url); return Response.json({}); }); }
  finally { male.abort(); }
  expect(calls).toEqual(["/api/facial/blink", "/api/idles", "/api/facial/blink"]);
});

test("shared core geometry outlives one cancelled reader, then completed bytes are reused", async () => {
  const owner = {}, a = new AbortController(), b = new AbortController(), c = new AbortController();
  const reply = Promise.withResolvers<Response>();
  let transport: AbortSignal | undefined;
  let geometries = 0;
  const fetcher = async (url: string, init?: RequestInit) => {
    if (url.endsWith("preview-core.json")) return Response.json(record);
    if (url.endsWith("head.glb")) { geometries++; transport = init!.signal!; return geometries === 1 ? reply.promise : new Response(bytes); }
    return new Response(bytes);
  };
  try {
    const first = await startCoreDetail(fetcher, "female", a.signal, owner).ready;
    const second = await startCoreDetail(fetcher, "female", b.signal, owner).ready;
    expect(geometries).toBe(1);
    a.abort();
    expect(transport!.aborted).toBe(false);
    reply.resolve(new Response(bytes));
    expect(Buffer.from(await second.geometry)).toEqual(bytes);
    await first.geometry.catch(() => {});
    expect(geometries).toBe(1);
    b.abort();
    const third = await startCoreDetail(fetcher, "female", c.signal, owner).ready;
    expect(Buffer.from(await third.geometry)).toEqual(bytes);
    expect(geometries).toBe(1);
    releaseCoreDetailFiles(owner);
    const afterRelease = await startCoreDetail(fetcher, "female", c.signal, owner).ready;
    expect(Buffer.from(await afterRelease.geometry)).toEqual(bytes); expect(geometries).toBe(2);
  } finally { reply.resolve(new Response(bytes)); a.abort(); b.abort(); c.abort(); }
});

test("the last core geometry reader aborts its transport; a later build can read again", async () => {
  const owner = {}, a = new AbortController(), b = new AbortController();
  let transport: AbortSignal | undefined, reads = 0;
  const fetcher = async (url: string, init?: RequestInit) => {
    if (url.endsWith("preview-core.json")) return Response.json(record);
    if (url.endsWith("head.glb") && ++reads === 1) return new Promise<Response>((_resolve, reject) => {
      transport = init!.signal!; transport.addEventListener("abort", () => reject(transport!.reason), { once: true });
    });
    return new Response(bytes);
  };
  try {
    const first = await startCoreDetail(fetcher, "female", a.signal, owner).ready;
    a.abort(); expect(transport!.aborted).toBe(true);
    await expect(first.geometry).rejects.toHaveProperty("name", "AbortError");
    const next = await startCoreDetail(fetcher, "female", b.signal, owner).ready;
    expect(Buffer.from(await next.geometry)).toEqual(bytes); expect(reads).toBe(2);
  } finally { a.abort(); b.abort(); }
});

test("the core loader consumes its verified read once without requesting those files again", async () => {
  const life = new AbortController(), calls: string[] = [];
  const read = startCoreDetail(async url => {
    calls.push(url); return url.endsWith("preview-core.json") ? Response.json(record) : new Response(bytes);
  }, "female", life.signal);
  try {
    await read.ready;
    // Deliberately invalid geometry, with a correct hash: the loader must reach parsing using these bytes, not fetch another copy.
    await expect(read.load({} as THREE.WebGLRenderer)).rejects.toHaveProperty("code", "preview_damaged");
    expect(calls).toHaveLength(6); expect(new Set(calls).size).toBe(6);
    await expect(read.load({} as THREE.WebGLRenderer)).rejects.toThrow("already consumed");
  } finally { life.abort(); }
});

test("motion read-ahead transfers cancellation to the rig that binds it", async () => {
  const realFetch = globalThis.fetch, life = new AbortController(), rig = new AbortController(), signals: AbortSignal[] = [];
  globalThis.fetch = Object.assign(async (_url: RequestInfo | URL, init?: RequestInit) => {
    signals.push(init!.signal!); return Response.json({}, { status: 404 });
  }, { preconnect: realFetch.preconnect });
  try {
    const load = startGameMotion("female", life.signal);
    await load(new THREE.Scene(), { mesh: new THREE.Mesh(), material: new THREE.MeshBasicMaterial(), replace() {} }, "female", rig.signal);
    expect(signals.every(signal => !signal.aborted)).toBe(true);
    rig.abort();
    expect(signals.every(signal => signal.aborted)).toBe(true);
  } finally { rig.abort(); life.abort(); globalThis.fetch = realFetch; }
});

test("a runtime failing before its core or rig exists aborts its early motion reads", async () => {
  const realFetch = globalThis.fetch, signals: AbortSignal[] = [];
  globalThis.fetch = Object.assign(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const signal = init!.signal!; signals.push(signal);
    return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  }, { preconnect: realFetch.preconnect });
  try {
    await expect(scenes.createSceneRuntime({ renderer: {}, add() { throw Error("context unavailable"); } } as never)).rejects.toThrow("context unavailable");
    expect(signals).toHaveLength(2);
    expect(signals.every(signal => signal.aborted)).toBe(true);
  } finally { globalThis.fetch = realFetch; }
});
