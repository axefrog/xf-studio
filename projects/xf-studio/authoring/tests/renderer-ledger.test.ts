/**
 * The maps every scene runtime on one renderer shares (character-detail-loader.ts `detailLedgerOf`; experiment 044 §16): one ledger per
 * renderer, a map's references counted across the runtimes that use it, its disposal when the last lets go.
 */
import { expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { DetailLedger, DetailPartPool, detailLedgerOf, textureLedgerKey, loadCharacterDetails, type ParsedGeometry, type WarmedFiles } from "../src/character/render/character-detail-loader";

import { beginContextGeneration, endContextGeneration } from "../src/platform/scene/context-generation";
import { CHARACTER_DETAIL_SCHEMA, type CharacterDetail, type RenderTexture } from "../src/character/render-detail";

const key = textureLedgerKey({ file: "a.png", isGamma: true }, "colour" as never, "clamp" as never);
/** A map in the ledger held by `parts` parts, as a load makes it. */
function shared(ledger: DetailLedger, parts: number) {
  const texture = new THREE.Texture(), disposed = { count: 0 };
  texture.addEventListener("dispose", () => disposed.count++);
  ledger.textures.set(key, { texture, refs: 0, file: "a.png" });
  const held = Array.from({ length: parts }, () => { ledger.textures.get(key)!.refs++; return { materials: [], owned: [], textureKeys: [key] }; });
  return { texture, disposed, held };
}

test("a renderer has one ledger, and another renderer has its own", () => {
  const a = {}, b = {};
  expect(detailLedgerOf(a)).toBe(detailLedgerOf(a));
  expect(detailLedgerOf(a)).not.toBe(detailLedgerOf(b));
});

test("pools given a renderer's ledger share its maps; a pool without one keeps its own", () => {
  const renderer = {};
  const first = new DetailPartPool(undefined, detailLedgerOf(renderer)), second = new DetailPartPool(undefined, detailLedgerOf(renderer));
  expect(first.ledger).toBe(second.ledger);
  expect(new DetailPartPool().ledger).not.toBe(first.ledger);
});

test("a map two runtimes use is disposed when the last of their parts lets go, not before", () => {
  const ledger = detailLedgerOf({});
  const { disposed, held } = shared(ledger, 2);
  ledger.release(held[0]);
  expect(disposed.count).toBe(0);
  expect(ledger.textures.has(key)).toBe(true);
  ledger.release(held[1]);
  expect(disposed.count).toBe(1);
  expect(ledger.textures.has(key)).toBe(false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const pending = new Promise<T>(done => { resolve = done; });
  return { pending, resolve };
}
const bytes = new Uint8Array([1, 2, 3]), hash = createHash("sha256").update(bytes).digest("hex");
const map: RenderTexture = { file: `${hash}.png`, sha256: hash, sources: [], depotPath: "fixture.png", width: 2, height: 2, isGamma: true };
function record(texture = map, unused = false): CharacterDetail {
  return { schema: CHARACTER_DETAIL_SCHEMA, detail: "character", identity: "a".repeat(64), origin: "game-files",
    character: { source: "save", bodyGender: "female" }, provenance: { label: "fixture", notes: [] },
    slots: [{ slot: "face", state: "shown", label: "fixture" }], components: [{ id: "face:a", slot: "face", option: "a", definition: "a", component: "a",
      geometry: { file: "fixture.glb", sha256: hash, sources: [], depotPath: "fixture.mesh", depotHash: "1", morphTargets: false }, renderChunks: 1, chunks: [0],
      materials: [{ chunk: 0, name: "m", template: "base\\materials\\mesh_decal.mt", templateName: null, materialPriority: "EMP_Normal", scalars: {}, colours: {},
        textures: unused ? { UnusedInput: texture, DiffuseTexture: map } : { DiffuseTexture: texture }, profiles: {}, skinProfiles: {}, gradients: {} }] }] };
}
/** A real drawable skinned triangle, supplied through the loader's warmed geometry port. */
function geometry(): ParsedGeometry {
  const shape = new THREE.BufferGeometry();
  shape.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  shape.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  shape.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  shape.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(12), 4));
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  shape.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  const bone = new THREE.Bone(), mesh = new THREE.SkinnedMesh(shape);
  mesh.name = "submesh_00_LOD_1";
  mesh.bind(new THREE.Skeleton([bone]));
  const scene = new THREE.Group(); scene.add(bone, mesh);
  return { scene, weights: new Map([[mesh.name, weights]]) };
}
function options(pool: DetailPartPool, parsed: Promise<ParsedGeometry> = Promise.resolve(geometry())) {
  const warmed: WarmedFiles = { bytes: () => undefined, texture: () => undefined, geometry: () => parsed };
  return { pool, warmed, anisotropy: 1, context: () => ({ overMakeup: false, profileEncoding: "srgb-decoded" as const }),
    fetcher: async () => new Response(bytes.slice()) };
}
/** Count the browser's actual decode entry points, with tiny stand-ins for DOM images and bitmaps (no GPU needed). */
async function decoding(run: (state: { decodes: number; bitmapDecodes: number; closed: number }) => Promise<void>) {
  const state = { decodes: 0, bitmapDecodes: 0, closed: 0 }, original = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const imageLoader = spyOn(THREE.ImageLoader.prototype, "loadAsync").mockImplementation(async () => {
    state.decodes++;
    return { width: 2, height: 2 } as HTMLImageElement;
  });
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: async () => {
    state.bitmapDecodes++;
    const bitmap = { width: 2, height: 2, close() { state.closed++; bitmap.width = bitmap.height = 0; } };
    return bitmap;
  } });
  try { await run(state); }
  finally {
    imageLoader.mockRestore();
    if (original) Object.defineProperty(globalThis, "createImageBitmap", original); else Reflect.deleteProperty(globalThis, "createImageBitmap");
  }
}

test("terminal pools release late returns, including a texture shared with another runtime", async () => {
  await decoding(async () => {
    const ledger = detailLedgerOf({}), a = new DetailPartPool(undefined, ledger), b = new DetailPartPool(undefined, ledger);
    const first = await loadCharacterDetails(record(), options(a));
    const second = await loadCharacterDetails(record(), options(b));
    const entry = [...ledger.textures.values()][0]!;
    let disposed = 0; entry.texture.addEventListener("dispose", () => disposed++);
    expect(entry.refs).toBe(2);
    // B goes away before its completed load is returned by its caller.
    b.dispose(); second.dispose();
    expect(b.size).toBe(0);
    expect(entry.refs).toBe(1);
    first.dispose(); a.dispose();
    expect(entry.refs).toBe(0);
    expect(disposed).toBe(1);
    expect(ledger.textures.size).toBe(0);
    expect(ledger.images.size).toBe(0);
  });
});

test("cancelling runtime B during geometry loading cannot pin A's shared texture after both close", async () => {
  await decoding(async () => {
    const ledger = detailLedgerOf({}), a = new DetailPartPool(undefined, ledger), b = new DetailPartPool(undefined, ledger);
    const first = await loadCharacterDetails(record(), options(a));
    const entry = [...ledger.textures.values()][0]!;
    let disposed = 0; entry.texture.addEventListener("dispose", () => disposed++);
    const waiting = deferred<ParsedGeometry>(), started = deferred<void>(), signal = new AbortController();
    const opts = options(b, waiting.pending);
    opts.warmed.geometry = () => { started.resolve(); return waiting.pending; };
    const late = loadCharacterDetails(record(), { ...opts, signal: signal.signal });
    const rejected = late.then(() => null, error => error);
    await started.pending;
    signal.abort(); b.dispose();
    first.dispose(); a.dispose();
    waiting.resolve(geometry());
    expect(await rejected).toMatchObject({ name: "AbortError" });
    expect(entry.refs).toBe(0);
    expect(disposed).toBe(1);
    expect(b.size).toBe(0);
    expect(ledger.textures.size).toBe(0);
    expect(ledger.images.size).toBe(0);
  });
});

test("three failed geometries leave no decoded images or bitmaps", async () => {
  await decoding(async state => {
    const ledger = detailLedgerOf({}), pool = new DetailPartPool(undefined, ledger);
    for (let i = 0; i < 3; i++) {
      const failed = await loadCharacterDetails(record({ ...map, file: `failed-${i}.png` }), options(pool, Promise.reject(Error("geometry failed"))));
      expect(failed.problems).toHaveLength(1);
      failed.dispose();
      expect(ledger.images.size).toBe(0);
      expect(ledger.bitmaps.size).toBe(0);
    }
    expect(state.decodes).toBe(3);
    expect(state.closed).toBe(3);
    pool.dispose();
  });
});

test("unused adapter inputs have no image owner after the load builds its materials", async () => {
  await decoding(async () => {
    const ledger = detailLedgerOf({}), pool = new DetailPartPool(undefined, ledger);
    const unused = { ...map, file: "unused.png" };
    const loaded = await loadCharacterDetails(record(unused, true), options(pool));
    expect(loaded.problems).toEqual([]);
    expect(ledger.images.has(unused.file)).toBe(false);
    expect(ledger.images.has(map.file)).toBe(true);
    loaded.dispose(); pool.dispose();
    expect(ledger.images.size).toBe(0);
  });
});

test("concurrent runtimes share one fetch/hash/decode and cancellation only releases its requester", async () => {
  await decoding(async state => {
    const ledger = detailLedgerOf({}), a = new DetailPartPool(undefined, ledger), b = new DetailPartPool(undefined, ledger);
    const fetched = deferred<void>(), response = deferred<Response>(), cancel = new AbortController();
    let fetches = 0, sharedSignal: AbortSignal | null | undefined;
    const fetcher = (_url: string, init?: RequestInit) => { fetches++; sharedSignal = init?.signal; fetched.resolve(); return response.pending; };
    const first = loadCharacterDetails(record(), { ...options(a), fetcher, signal: cancel.signal });
    const rejected = first.then(() => null, error => error);
    const second = loadCharacterDetails(record(), { ...options(b), fetcher });
    await fetched.pending;
    cancel.abort();
    expect(sharedSignal?.aborted).toBe(false);
    response.resolve(new Response(bytes.slice()));
    expect(await rejected).toMatchObject({ name: "AbortError" });
    const loaded = await second;
    expect(loaded.problems).toEqual([]);
    expect(fetches).toBe(1);
    expect(state.decodes).toBe(1);
    expect(state.bitmapDecodes).toBe(1);
    loaded.dispose(); a.dispose(); b.dispose();
    expect(ledger.textures.size).toBe(0);
    expect(ledger.images.size).toBe(0);
  });
});

test("the final requester aborts shared work, and a late decode cannot retain images", async () => {
  const ledger = detailLedgerOf({}), cancelled = new AbortController(), ready = deferred<void>(), result = deferred<ReturnType<typeof decoded>>();
  let sharedSignal: AbortSignal | undefined, closed = 0;
  function decoded() { return { image: {} as HTMLImageElement, bitmap: { width: 2, height: 2, close() { closed++; } } as ImageBitmap, reduced: null, bytes: 3 }; }
  const lease = ledger.requestImage(map.file, signal => { sharedSignal = signal; ready.resolve(); return result.pending; }, cancelled.signal);
  const rejected = lease.pending.then(() => null, error => error);
  await ready.pending;
  cancelled.abort();
  expect(sharedSignal?.aborted).toBe(true);
  result.resolve(decoded());
  expect(await rejected).toMatchObject({ name: "AbortError" });
  // Drain the non-cancellable decoder's answer.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(closed).toBe(1);
  expect(ledger.images.size).toBe(0);
  expect(ledger.bitmaps.size).toBe(0);
});

test("a restored renderer uses a new ledger and never reuses a dead generation's texture", async () => {
  await decoding(async () => {
    const renderer = {}, oldLedger = detailLedgerOf(renderer), oldPool = new DetailPartPool(undefined, oldLedger);
    const before = await loadCharacterDetails(record(), options(oldPool));
    const dead = [...oldLedger.textures.values()][0]!.texture;
    endContextGeneration(renderer); beginContextGeneration(renderer);
    const ledger = detailLedgerOf(renderer), pool = new DetailPartPool(undefined, ledger);
    expect(ledger).not.toBe(oldLedger);
    const after = await loadCharacterDetails(record(), { ...options(pool), reuse: before });
    expect(after.reused).toBe(0);
    expect([...ledger.textures.values()][0]!.texture).not.toBe(dead);
    before.dispose(); oldPool.dispose(); after.dispose(); pool.dispose();
    expect(oldLedger.textures.size).toBe(0);
    expect(ledger.textures.size).toBe(0);
  });
});


test("two concurrent successful loads fetch and decode once and retain the map until both release", async () => {
  await decoding(async state => {
    const ledger = detailLedgerOf({}), a = new DetailPartPool(undefined, ledger), b = new DetailPartPool(undefined, ledger);
    const response = deferred<Response>();
    let fetches = 0;
    const fetcher = () => { fetches++; return response.pending; };
    const first = loadCharacterDetails(record(), { ...options(a), fetcher });
    const second = loadCharacterDetails(record(), { ...options(b), fetcher });
    response.resolve(new Response(bytes.slice()));
    const [one, two] = await Promise.all([first, second]);
    expect(one.problems).toEqual([]); expect(two.problems).toEqual([]);
    expect(fetches).toBe(1); expect(state.decodes).toBe(1); expect(state.bitmapDecodes).toBe(1);
    const entry = [...ledger.textures.values()][0]!;
    let disposed = 0; entry.texture.addEventListener("dispose", () => disposed++);
    expect(entry.refs).toBe(2);
    one.dispose(); a.dispose();
    expect(entry.refs).toBe(1); expect(disposed).toBe(0);
    two.dispose(); b.dispose();
    expect(entry.refs).toBe(0); expect(disposed).toBe(1);
    expect(ledger.images.size).toBe(0);
  });
});

test("failed material construction releases its texture and both warmed bitmap copies", async () => {
  const ledger = detailLedgerOf({}), pool = new DetailPartPool(undefined, ledger), opts = options(pool);
  let uploadClosed = 0, reducedClosed = 0;
  const bitmap = { width: 2, height: 2, close() { uploadClosed++; bitmap.width = bitmap.height = 0; } };
  opts.warmed.texture = () => Promise.resolve({ image: {} as HTMLImageElement, reduced: { close() { reducedClosed++; } } as ImageBitmap,
    bitmap: bitmap as ImageBitmap });
  const broken = record();
  // Acquires DiffuseTexture before failing for the required SecondaryDiffuseAlpha.
  broken.components[0]!.materials[0]!.template = "base\\materials\\mesh_decal_double_diffuse.mt";
  const loaded = await loadCharacterDetails(broken, opts);
  expect(loaded.components).toHaveLength(0);
  expect(loaded.problems).toHaveLength(1);
  expect(ledger.textures.size).toBe(0); expect(ledger.images.size).toBe(0); expect(ledger.bitmaps.size).toBe(0);
  expect(uploadClosed).toBe(1); expect(reducedClosed).toBe(1);
  loaded.dispose(); pool.dispose();
});


test("concurrent CPU readers share the element decode when the first request needed GPU use only", async () => {
  const ledger = detailLedgerOf({}), ready = deferred<void>();
  let decodes = 0, reads = 0;
  const image = { decode() { decodes++; return ready.pending; } } as HTMLImageElement;
  const bitmap = { width: 2, height: 2, close() {} } as ImageBitmap;
  const decode = async () => { reads++; return { image, bitmap, reduced: null, bytes: 3 }; };
  const gpu = ledger.requestImage(map.file, decode);
  await gpu.pending;
  const first = ledger.requestImage(map.file, decode, undefined, true), second = ledger.requestImage(map.file, decode, undefined, true);
  ready.resolve();
  await Promise.all([first.pending, second.pending]);
  expect(reads).toBe(1);
  expect(decodes).toBe(1);
  gpu.release(); first.release(); second.release();
  expect(ledger.images.size).toBe(0);
});
