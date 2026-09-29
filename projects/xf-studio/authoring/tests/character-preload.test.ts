import { expect, test } from "bun:test";
import { createBrowserCharacterDetailDevice } from "../src/browser-character-detail-device";
import { DEFAULT_CHARACTER } from "../src/character-detail-request";
import { CHARACTER_DETAIL_SCHEMA, DETAIL_SLOTS } from "../src/render-detail";

// Loading a prepared choice's parts ahead (PREV-189): the page asks the host as another page (never superseding the person's own V),
// loads and prepares the new parts, then lets them go to the part pool without showing them; the person's own change stops it.

const RECORD = `${"a".repeat(64)}.json`;
const record = { schema: CHARACTER_DETAIL_SCHEMA, detail: "character", identity: "a".repeat(64), origin: "game-files",
  character: { source: "default", bodyGender: "female" }, provenance: { label: "fixture", notes: [] }, components: [],
  slots: DETAIL_SLOTS.map(slot => ({ slot, state: "none", label: "None" })) };

function harness(phase: "ready" | "failed" = "ready") {
  const pages: string[] = [], events: string[] = [], signals: AbortSignal[] = [];
  let hold = false, release: (() => void) | null = null;
  const loaded = { record, components: [], problems: [], limits: [], notes: [], rigs: [], reused: 0, disposed: false, adopt() {},
    dispose() { events.push("dispose"); } };
  const scene = {
    setCharacterDetails: () => { events.push("placed"); return { limits: [] }; },
    details: { load: async (_record: unknown, options: { signal?: AbortSignal }) => {
      signals.push(options.signal!); events.push("load");
      if (hold) await new Promise<void>(resolve => { release = resolve; });
      return loaded;
    } },
    prepareDetails: async () => { events.push("prepare"); },
  };
  const fetcher = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      pages.push(new Headers(init.headers).get("X-XFS-Page")!);
      return Response.json({ recordSchema: CHARACTER_DETAIL_SCHEMA, key: "b".repeat(32), phase, message: "", progress: null, record: phase === "ready" ? RECORD : null });
    }
    return Response.json(record);
  };
  const device = createBrowserCharacterDetailDevice(scene as never, fetcher);
  return { device, pages, events, signals, holdLoads() { hold = true; }, release() { hold = false; release?.(); } };
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

test("a map's first upload comes from its decoded bitmap; the texture keeps its image, and the bitmap closes when no texture waits on it", async () => {
  const THREE = await import("three");
  const { hasUploadSource, offerUploadSource, uploadTexture } = await import("../src/character-detail-loader");
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

test("a map released before it was ever uploaded lets its bitmap go", async () => {
  const THREE = await import("three");
  const { hasUploadSource, offerUploadSource } = await import("../src/character-detail-loader");
  let closed = 0;
  const bitmap = { width: 4, height: 4, close() { closed++; } } as unknown as ImageBitmap;
  const texture = new THREE.Texture({ width: 4, height: 4 });
  offerUploadSource(texture, bitmap);
  texture.dispose();
  expect(hasUploadSource(texture)).toBe(false);
  expect(closed).toBe(1);
});
