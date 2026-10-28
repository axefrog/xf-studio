import { expect, spyOn, test } from "bun:test";
import * as THREE from "three";
import { CharacterWarmStart, WARM_KEEP_MS } from "../src/character/browser/character-warm-start";
import { DEFAULT_CHARACTER } from "../src/character/character-detail-request";
import { CHARACTER_DETAIL_SCHEMA, DETAIL_SLOTS, type CharacterDetail } from "../src/character/render-detail";

const deferred = <T>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve }; };
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const hash = "a".repeat(64), file = `${hash}.json`;
function options(signal: AbortSignal) {
  const timers = new Map<number, () => void>(); let writes = 0;
  return { signal, verification: true, timers, writes: () => writes,
    storage: { getItem: () => JSON.stringify(DEFAULT_CHARACTER), setItem: () => { writes++; } },
    setTimer: (run: () => void, ms: number) => { expect(ms).toBe(WARM_KEEP_MS); timers.set(1, run); return 1; },
    clearTimer: (id: unknown) => { timers.delete(id as number); } };
}

for (const phase of ["answer", "record"] as const) test(`warm owner cancels a delayed ${phase}, its expiry and later storage/publication`, async () => {
  const life = new AbortController(), opts = options(life.signal), late = deferred<Response>();
  const requests: { url: string; signal?: AbortSignal | null }[] = [];
  const warm = new CharacterWarmStart({ ...opts, fetcher: async (url, init) => {
    requests.push({ url, signal: init?.signal });
    return phase === "record" && requests.length === 1 ? Response.json({ phase: "ready", record: file }) : late.promise;
  } });
  const running = warm.start(); await settle();
  expect(opts.timers.size).toBe(1); expect(requests.length).toBe(phase === "record" ? 2 : 1);
  life.abort(); expect(opts.timers.size).toBe(0); expect(requests.every(request => request.signal?.aborted)).toBe(true);
  late.resolve(Response.json({ phase: "ready", record: file })); await running; await settle();
  warm.remember(DEFAULT_CHARACTER); await warm.start();
  expect(opts.writes()).toBe(0); expect(requests.length).toBe(phase === "record" ? 2 : 1);
  expect(warm.files.texture("late.png")).toBeUndefined();
});

test("pre-aborted warm start allocates no timer, read or write", async () => {
  const life = new AbortController(); life.abort(); const opts = options(life.signal);
  let reads = 0;
  const warm = new CharacterWarmStart({ ...opts, fetcher: async () => { reads++; throw Error("unexpected"); } });
  await warm.start(); warm.remember(DEFAULT_CHARACTER);
  expect([reads, opts.writes(), opts.timers.size]).toEqual([0, 0, 0]);
});

for (const stop of ["application", "expiry", "expiry then application"] as const) test(`a taken bitmap decode respects ${stop} ownership`, async () => {
  const life = new AbortController(), opts = options(life.signal), decoded = deferred<ImageBitmap>(); let closes = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: () => decoded.promise });
  const image = spyOn(THREE.ImageLoader.prototype, "loadAsync").mockResolvedValue({} as HTMLImageElement);
  const bytes = new Uint8Array([1, 2, 3]).buffer, digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const texture = `${digest}.png`;
  const record: CharacterDetail = { schema: CHARACTER_DETAIL_SCHEMA, detail: "character", identity: hash, origin: "game-files",
    character: { source: "default", bodyGender: "female" }, provenance: { label: "fixture", notes: [] },
    slots: DETAIL_SLOTS.map(slot => ({ slot, state: slot === "face" ? "shown" : "none", label: "Fixture" })),
    components: [{ id: "face:a", slot: "face", option: "a", definition: "a", component: "a",
      geometry: { file: `${hash}.glb`, sha256: hash, sources: [], depotPath: "fixture.mesh", depotHash: "1", morphTargets: false }, renderChunks: 1, chunks: [0],
      materials: [{ chunk: 0, name: "m", template: "base\\materials\\mesh_decal.mt", templateName: null, materialPriority: "EMP_Normal", scalars: {}, colours: {},
        textures: { DiffuseTexture: { file: texture, sha256: digest, sources: [], depotPath: "fixture.png", width: 1, height: 1, isGamma: true } },
        profiles: {}, skinProfiles: {}, gradients: {} }] }] };
  const geometry = deferred<Response>(), signals: AbortSignal[] = [];
  const warm = new CharacterWarmStart({ ...opts, fetcher: async (url, init) => {
    signals.push(init!.signal!);
    if (url === "/api/preview-character") return Response.json({ phase: "ready", record: file });
    if (url.endsWith(file)) return Response.json(record);
    if (url.endsWith(".glb")) return geometry.promise;
    return new Response(bytes);
  } });
  try {
    await warm.start();
    // Hashing uses the host's async crypto job. A bounded task turn lets the real decode begin.
    for (let i = 0; i < 50 && !image.mock.calls.length; i++) await Bun.sleep(2);
    expect(image).toHaveBeenCalledTimes(1);
    const taken = warm.files.texture(texture)!; expect(taken).toBeDefined();
    const outcome = taken.then(value => ({ value }), error => ({ error: error as Error }));
    if (stop !== "application") opts.timers.get(1)!();
    if (stop !== "expiry") life.abort();
    decoded.resolve({ close: () => { closes++; } } as unknown as ImageBitmap);
    geometry.resolve(new Response(bytes)); const result = await outcome; await settle();
    if (stop === "expiry") {
      expect("value" in result).toBe(true); expect(closes).toBe(0);
      if ("value" in result) result.value.bitmap?.close();
      expect(signals.some(signal => !signal.aborted)).toBe(true);
    } else { expect(result).toMatchObject({ error: { name: "AbortError" } }); expect(signals.every(signal => signal.aborted)).toBe(true); }
    expect(closes).toBe(1); expect(opts.timers.size).toBe(0);
    expect(warm.files.texture(texture)).toBeUndefined();
  } finally { life.abort(); geometry.resolve(new Response(bytes)); decoded.resolve({ close() {} } as ImageBitmap); image.mockRestore();
    if (previous) Object.defineProperty(globalThis, "createImageBitmap", previous); else Reflect.deleteProperty(globalThis, "createImageBitmap"); }
});
