import { expect, test } from "bun:test";
import { createBrowserCharacterDetailDevice } from "../src/character/browser/browser-character-detail-device";
import { DEFAULT_CHARACTER } from "../src/character/character-detail-request";
import { CHARACTER_DETAIL_SCHEMA, DETAIL_SLOTS } from "../src/character/render-detail";

// Loading a prepared choice's parts ahead (PREV-189): the page asks the host as another page (never superseding the person's own V),
// loads and prepares the new parts, then lets them go to the part pool without showing them; the person's own change stops it.

const RECORD = `${"a".repeat(64)}.json`;
const record = { schema: CHARACTER_DETAIL_SCHEMA, detail: "character", identity: "a".repeat(64), origin: "game-files",
  character: { source: "default", bodyGender: "female" }, provenance: { label: "fixture", notes: [] }, components: [],
  slots: DETAIL_SLOTS.map(slot => ({ slot, state: "none", label: "None" })) };

function harness(phase: "ready" | "failed" = "ready") {
  const pages: string[] = [], events: string[] = [], signals: AbortSignal[] = [];
  let hold = false, release: (() => void) | null = null, holdPrepare = false, releasePrepare: (() => void) | null = null;
  const loaded = { record, components: [], problems: [], limits: [], notes: [], rigs: [], reused: 0, disposed: false, adopt() {},
    dispose() { events.push("dispose"); } };
  const scene = {
    setCharacterDetails: () => { events.push("placed"); return { limits: [] }; },
    details: { load: async (_record: unknown, options: { signal?: AbortSignal }) => {
      signals.push(options.signal!); events.push("load");
      if (hold) await new Promise<void>(resolve => { release = resolve; });
      return loaded;
    } },
    prepareDetails: async () => {
      events.push("prepare");
      if (holdPrepare) { holdPrepare = false; await new Promise<void>(resolve => { releasePrepare = resolve; }); events.push("prepared"); }
    },
  };
  const fetcher = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      pages.push(new Headers(init.headers).get("X-XFS-Page")!);
      return Response.json({ recordSchema: CHARACTER_DETAIL_SCHEMA, key: "b".repeat(32), phase, message: "", progress: null, record: phase === "ready" ? RECORD : null });
    }
    return Response.json(record);
  };
  const device = createBrowserCharacterDetailDevice(scene as never, fetcher);
  return { device, pages, events, signals, holdLoads() { hold = true; }, release() { hold = false; release?.(); },
    holdPrepare() { holdPrepare = true; }, releasePrepare() { releasePrepare?.(); } };
}

test("a prepared choice's parts load ahead as another page's V: prepared, then let go to the pool, never shown", async () => {
  const { device, pages, events } = harness();
  await device.preload!(DEFAULT_CHARACTER, new AbortController().signal);
  expect(events).toEqual(["load", "prepare", "dispose"]);
  expect(pages).toHaveLength(1);
  expect(pages[0]).toMatch(/^[a-f0-9]{32}-ahead$/);
  // The person's own request names the page itself, so the host never lets the load ahead supersede it (PIPE-103).
  await device.request(DEFAULT_CHARACTER, new AbortController().signal);
  expect(pages[1]).toBe(pages[0]!.replace(/-ahead$/, ""));
});

test("a choice the host couldn't prepare loads nothing ahead", async () => {
  const { device, events } = harness("failed");
  await device.preload!(DEFAULT_CHARACTER, new AbortController().signal);
  expect(events).toEqual([]);
});

test("the person's own change stops a load ahead at once: it is neither prepared nor waited for", async () => {
  const { device, events, signals, holdLoads, release } = harness();
  holdLoads();
  const ahead = device.preload!(DEFAULT_CHARACTER, new AbortController().signal);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(events).toEqual(["load"]);
  const shown = device.show(RECORD, new AbortController().signal);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(signals[0]!.aborted).toBe(true);
  release();
  await ahead; await shown;
  // Its parts went to the pool unprepared; the change loaded, prepared and placed its own.
  expect(events).toEqual(["load", "dispose", "load", "prepare", "placed"]);
});

test("a change made while a load ahead is preparing waits for its parts to reach the pool, then loads from there (PREV-192)", async () => {
  const { device, events, signals, holdPrepare, releasePrepare } = harness();
  holdPrepare();
  const ahead = device.preload!(DEFAULT_CHARACTER, new AbortController().signal);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(events).toEqual(["load", "prepare"]);
  const shown = device.show(RECORD, new AbortController().signal);
  await new Promise(resolve => setTimeout(resolve, 10));
  // The load ahead is stopped, and the change doesn't load until the parts it built are in the pool.
  expect(signals[0]!.aborted).toBe(true);
  expect(events).toEqual(["load", "prepare"]);
  releasePrepare();
  await ahead; await shown;
  expect(events).toEqual(["load", "prepare", "prepared", "dispose", "load", "prepare", "placed"]);
});

test("a map's first upload comes from its decoded bitmap; the texture keeps its image, and the bitmap closes when no texture waits on it", async () => {
  const THREE = await import("three");
  const { hasUploadSource, offerUploadSource, uploadTexture } = await import("../src/character/render/character-detail-loader");
  let closed = 0;
  const bitmap = { width: 4, height: 4, close() { closed++; } } as unknown as ImageBitmap;
  const element = { width: 4, height: 4 };
  // Two textures of one file (two uses of one map) share its bitmap.
  const colour = new THREE.Texture(element), data = new THREE.Texture(element);
  offerUploadSource(colour, bitmap); offerUploadSource(data, bitmap);
  const seen: unknown[] = [];
  const upload = (texture: InstanceType<typeof THREE.Texture>) => { seen.push(texture.image); };
  expect(uploadTexture(colour, upload)).toBe(true);
  expect(seen).toEqual([bitmap]);
  expect(colour.image).toBe(element);
  expect(closed).toBe(0);
  expect(uploadTexture(data, upload)).toBe(true);
  expect(closed).toBe(1);
  expect([hasUploadSource(colour), hasUploadSource(data)]).toEqual([false, false]);
  // Uploaded again later (a restored context): from its image, as before.
  expect(uploadTexture(colour, upload)).toBe(false);
  expect(seen.at(-1)).toBe(element);
});

test("a large map's first upload goes in bands of rows: its storage first, then a band per step, the mipmaps with the last; any caller continues it (4a-v-b)", async () => {
  const THREE = await import("three");
  const { hasUploadSource, offerUploadSource, uploadStep, uploadUnfinished } = await import("../src/character/render/character-detail-loader");
  let closed = 0;
  const bitmap = { width: 4096, height: 4096, close() { closed++; } } as unknown as ImageBitmap;
  const texture = new THREE.Texture({ width: 4096, height: 4096 });
  texture.onUpdate = () => { throw Error("Three's own upload ran"); };
  offerUploadSource(texture, bitmap);
  const calls: string[] = [];
  const renderer = {
    initTexture: (map: InstanceType<typeof THREE.Texture>) => { calls.push(`storage:${map.image === bitmap}:${map.source.dataReady}`); },
    copyTextureToTexture: (source: InstanceType<typeof THREE.Texture>, target: InstanceType<typeof THREE.Texture>, region: InstanceType<typeof THREE.Box2>) => {
      calls.push(`band:${region.min.y}-${region.max.y}:${source.image === bitmap}:${target === texture}:${target.generateMipmaps}`);
    },
  } as unknown as InstanceType<typeof THREE.WebGLRenderer>;
  // The storage (no texels, Three's `onUpdate` not run, so the bitmap stays), then bands: unfinished until the last.
  expect(uploadStep(texture, renderer)).toBe(false);
  expect(uploadUnfinished(texture)).toBe(true);
  let steps = 1;
  while (!uploadStep(texture, renderer)) steps++;
  expect(steps).toBe(8);
  expect(calls[0]).toBe("storage:true:false");
  expect(calls.slice(1, 3)).toEqual(["band:0-512:true:true:false", "band:512-1024:true:true:false"]);
  expect(calls.at(-1)).toBe("band:3584-4096:true:true:true");
  expect([texture.image.width, texture.source.dataReady, texture.generateMipmaps, uploadUnfinished(texture), hasUploadSource(texture), closed])
    .toEqual([4096, true, true, false, false, 1]);
  // A small map goes whole, as before.
  const small = new THREE.Texture({ width: 4, height: 4 }), seen: unknown[] = [];
  offerUploadSource(small, { width: 4, height: 4, close() {} } as unknown as ImageBitmap);
  expect(uploadStep(small, { initTexture: (map: InstanceType<typeof THREE.Texture>) => { seen.push(map.image); } } as unknown as InstanceType<typeof THREE.WebGLRenderer>)).toBe(true);
  expect(seen).toHaveLength(1);
});

/** A renderer stand-in for banded uploads, with Three's texture versions (`properties`) and its texture-size limit, recording its calls. */
async function bandingRenderer(options: { maxTextureSize?: number } = {}) {
  const THREE = await import("three");
  const calls: string[] = [];
  let properties = new WeakMap<object, { __version?: number }>();
  const entry = (object: object) => properties.get(object) ?? properties.set(object, {}).get(object)!;
  const renderer = {
    capabilities: { maxTextureSize: options.maxTextureSize ?? 16384 },
    properties: { get: entry },
    initTexture: (map: InstanceType<typeof THREE.Texture>) => {
      calls.push(`storage:${(map.image as { width: number }).width}:${map.source.dataReady}`);
      entry(map).__version = map.version;
    },
    copyTextureToTexture: (source: InstanceType<typeof THREE.Texture>, _target: unknown, region: InstanceType<typeof THREE.Box2>) => {
      if (!(source.image as ImageBitmap).width) throw Error("copied from a closed bitmap");
      calls.push(`band:${region.min.y}-${region.max.y}:${region.max.x}`);
    },
  } as unknown as InstanceType<typeof THREE.WebGLRenderer>;
  /** A restored context: Three's properties start again, so nothing is uploaded. */
  return { renderer, calls, restore() { properties = new WeakMap(); } };
}
/** A decoded bitmap stand-in that reads 0 by 0 once closed, as a real one does. */
const bitmapOf = (size: number) => {
  const bitmap = { width: size, height: size, closed: 0, close() { bitmap.closed++; bitmap.width = bitmap.height = 0; } };
  return bitmap;
};

test("upload admission counts the next band, its short tail, storage and fallback uploads (PREV-196)", async () => {
  const THREE = await import("three");
  const { offerUploadSource, uploadStep, uploadStepTexels } = await import("../src/character/render/character-detail-loader");
  const { renderer } = await bandingRenderer();
  const texture = new THREE.Texture({ width: 4096, height: 1100 });
  offerUploadSource(texture, { width: 4096, height: 1100, close() {} } as ImageBitmap);
  expect(uploadStepTexels(texture, renderer)).toBe(1);
  uploadStep(texture, renderer);
  for (let i = 0; i < 2; i++) { expect(uploadStepTexels(texture, renderer)).toBe(4096 * 512); uploadStep(texture, renderer); }
  expect(uploadStepTexels(texture, renderer)).toBe(4096 * 76);
  expect(uploadStep(texture, renderer)).toBe(true);
  const whole = new THREE.Texture({ width: 1024, height: 1024 });
  expect(uploadStepTexels(whole, renderer)).toBe(1024 * 1024);
  const large = new THREE.Texture({ width: 8192, height: 8192 });
  offerUploadSource(large, bitmapOf(8192) as unknown as ImageBitmap);
  expect(uploadStepTexels(large, (await bandingRenderer({ maxTextureSize: 4096 })).renderer)).toBe(8192 * 8192);
  large.dispose(); texture.dispose(); whole.dispose();
});

test("a banded upload a lost context interrupted starts again after the restore, from its bitmap, and is never marked done early (4a-v-b review 3)", async () => {
  const THREE = await import("three");
  const { offerUploadSource, uploadStep, uploadUnfinished } = await import("../src/character/render/character-detail-loader");
  const { beginContextGeneration, endContextGeneration } = await import("../src/platform/scene/context-generation");
  const { renderer, calls, restore } = await bandingRenderer();
  const bitmap = bitmapOf(4096);
  const texture = new THREE.Texture({ width: 4096, height: 4096 });
  offerUploadSource(texture, bitmap as unknown as ImageBitmap);
  // Its storage and two bands, then the context is lost and restored.
  for (let i = 0; i < 3; i++) expect(uploadStep(texture, renderer)).toBe(false);
  endContextGeneration(renderer);
  expect(uploadUnfinished(texture)).toBe(false);
  restore(); beginContextGeneration(renderer);
  // It starts again: storage, then every band from the top, from the bitmap (still open), and done only after the last.
  calls.length = 0;
  let steps = 1;
  while (!uploadStep(texture, renderer)) steps++;
  expect(steps).toBe(9);
  expect(calls[0]).toBe("storage:4096:false");
  expect(calls[1]).toBe("band:0-512:4096");
  expect(calls.at(-1)).toBe("band:3584-4096:4096");
  expect(bitmap.closed).toBe(1);
});

test("a banded upload whose texture Three uploaded whole meanwhile (its bitmap closed) finishes without a copy from the closed bitmap (4a-v-b review 3)", async () => {
  const THREE = await import("three");
  const { offerUploadSource, uploadStep } = await import("../src/character/render/character-detail-loader");
  const { beginContextGeneration, endContextGeneration } = await import("../src/platform/scene/context-generation");
  const { renderer, calls, restore } = await bandingRenderer();
  const bitmap = bitmapOf(2048);
  const texture = new THREE.Texture({ width: 2048, height: 2048 });
  offerUploadSource(texture, bitmap as unknown as ImageBitmap);
  expect(uploadStep(texture, renderer)).toBe(false);
  expect(uploadStep(texture, renderer)).toBe(false);
  // Restored, and drawn before the upload went on: Three uploaded it whole from its image, and its `onUpdate` closed the bitmap.
  endContextGeneration(renderer); restore(); beginContextGeneration(renderer);
  renderer.initTexture(texture); texture.onUpdate?.(texture);
  expect(bitmap.closed).toBe(1);
  calls.length = 0;
  // No band is copied from the closed bitmap: the map is uploaded (an ordinary upload, which Three skips for a current texture).
  expect(uploadStep(texture, renderer)).toBe(true);
  expect(calls.filter(call => call.startsWith("band"))).toEqual([]);
});

test("a banded upload whose texture changed meanwhile starts again; one larger than the renderer's textures goes whole, never in bands (4a-v-b review 6)", async () => {
  const THREE = await import("three");
  const { offerUploadSource, uploadStep, uploadUnfinished } = await import("../src/character/render/character-detail-loader");
  {
    const { renderer, calls } = await bandingRenderer();
    const texture = new THREE.Texture({ width: 2048, height: 2048 });
    offerUploadSource(texture, bitmapOf(2048) as unknown as ImageBitmap);
    expect(uploadStep(texture, renderer)).toBe(false);
    expect(uploadStep(texture, renderer)).toBe(false);
    // A new version: its storage is Three's to make again, so the banded upload starts over and isn't done after its old last band.
    texture.needsUpdate = true;
    calls.length = 0;
    let steps = 1;
    while (!uploadStep(texture, renderer)) steps++;
    expect(steps).toBe(5);
    expect(calls).toEqual(["storage:2048:false", "band:0-512:2048", "band:512-1024:2048", "band:1024-1536:2048", "band:1536-2048:2048"]);
  }
  {
    // 8192² on a renderer whose textures are at most 4096²: Three makes it smaller, so it goes through Three's own upload, whole.
    const { renderer, calls } = await bandingRenderer({ maxTextureSize: 4096 });
    const texture = new THREE.Texture({ width: 8192, height: 8192 });
    offerUploadSource(texture, bitmapOf(8192) as unknown as ImageBitmap);
    expect(uploadStep(texture, renderer)).toBe(true);
    expect(uploadUnfinished(texture)).toBe(false);
    expect(calls).toEqual(["storage:8192:true"]);
  }
});

test("a map released before it was ever uploaded lets its bitmap go", async () => {
  const THREE = await import("three");
  const { hasUploadSource, offerUploadSource } = await import("../src/character/render/character-detail-loader");
  let closed = 0;
  const bitmap = { width: 4, height: 4, close() { closed++; } } as unknown as ImageBitmap;
  const texture = new THREE.Texture({ width: 4, height: 4 });
  offerUploadSource(texture, bitmap);
  texture.dispose();
  expect(hasUploadSource(texture)).toBe(false);
  expect(closed).toBe(1);
});

test("a map uploaded by the renderer itself lets its bitmap go too (PREV-193)", async () => {
  const THREE = await import("three");
  const { hasUploadSource, offerUploadSource } = await import("../src/character/render/character-detail-loader");
  let closed = 0, earlier = 0;
  const bitmap = { width: 4, height: 4, close() { closed++; } } as unknown as ImageBitmap;
  const texture = new THREE.Texture({ width: 4, height: 4 });
  texture.onUpdate = () => { earlier++; };
  offerUploadSource(texture, bitmap);
  // What Three's own upload calls once the texels are on the GPU.
  texture.onUpdate!(texture);
  expect(hasUploadSource(texture)).toBe(false);
  expect([closed, earlier]).toEqual([1, 1]);
});

test("a map's PNG reaches every decode without the chunks that would convert its colours (PREV-193)", async () => {
  const { withoutColourChunks } = await import("../src/character/render/character-detail-loader");
  const chunk = (type: string, body: number[]) => {
    const out = new Uint8Array(12 + body.length), view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    out.set([...type].map(char => char.charCodeAt(0)), 4);
    out.set(body, 8);
    view.setUint32(8 + body.length, 0x12345678);
    return [...out];
  };
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const header = chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]), data = chunk("IDAT", [1, 2, 3]), end = chunk("IEND", []);
  const tagged = new Uint8Array([...signature, ...header, ...chunk("gAMA", [0, 0, 0xb1, 0x8f]), ...chunk("iCCP", [65, 0, 0, 9]),
    ...chunk("sRGB", [0]), ...chunk("cHRM", new Array(32).fill(0)), ...data, ...end]).buffer;
  expect([...new Uint8Array(withoutColourChunks(tagged))]).toEqual([...signature, ...header, ...data, ...end]);
  // Untagged (the usual case) and anything it can't walk come back as they are.
  const plain = new Uint8Array([...signature, ...header, ...data, ...end]).buffer;
  expect(withoutColourChunks(plain)).toBe(plain);
  const truncated = tagged.slice(0, 40);
  expect(withoutColourChunks(truncated)).toBe(truncated);
});
