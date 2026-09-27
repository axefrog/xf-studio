import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyColourMatrix, type ChoicePreviewSource, compositeChannels, isPreviewKey, parsePreviewSource, PREVIEW_STYLES, previewCamera, previewColourMatrix,
  previewKey, previewKeyInput, previewKindOf, previewSourceOf, type PreviewTokens, TURNTABLE, turntableYaw } from "../src/choice-preview";
import { ChoicePreviewStore, manifestStamp } from "../src/choice-preview-host";
import { createChoicePreviewHandler } from "../src/choice-preview-server";
import { ChoicePreviewService, type ChoicePreviewPort, type PreviewAsk } from "../src/choice-preview-service";
import type { RenderComponent } from "../src/render-detail";
import { DEFAULT_CHARACTER } from "../src/character-detail-request";

/** Choice previews phase 1 (research/character-customization/choice-previews-design.md §10): keys, sources, theming, camera, store, endpoint, scheduling. */
const hex = (n: number) => n.toString(16).padStart(64, "0");
const texture = (n: number, depotPath: string) => ({ file: `${hex(n)}.png`, sha256: hex(n), sources: [], depotPath, width: 64, height: 64, isGamma: false });
const chunk = (index: number, templateName: string, textures: Record<string, ReturnType<typeof texture>>, scalars: Record<string, number> = {}) =>
  ({ chunk: index, name: `m${index}`, template: null, templateName, materialPriority: null, scalars, colours: {}, textures, profiles: {}, skinProfiles: {}, gradients: {} });
const component = (slot: RenderComponent["slot"], n: number, materials: ReturnType<typeof chunk>[], archive = "basegame_4_appearance.archive"): RenderComponent => ({
  id: `${slot}:${n}`, slot, option: "any_option", definition: "any", component: `part_${n}`,
  geometry: { file: `${hex(100 + n)}.glb`, sha256: hex(100 + n), depotPath: `base\\part_${n}.mesh`, depotHash: String(1000 + n), morphTargets: false,
    sources: [{ depotPath: `base\\part_${n}.mesh`, archive, provider: "Installed game" }] },
  renderChunks: materials.length, chunks: materials.map(m => m.chunk), materials } as RenderComponent);
const hairParts = (archive?: string, gradient = 7) => [
  component("skin", 1, [chunk(0, "skin", {})]),
  component("hair", 2, [chunk(0, "hair", { Strand_Alpha: texture(5, "base\\hair\\alpha.xbm"), Strand_Gradient: texture(gradient, "base\\hair\\grad.xbm") }, { AlphaCutoff: 0.33 }),
    chunk(2, "mesh_decal_gradientmap_recolor", { MaskTexture: texture(6, "base\\hair\\cap_mask.xbm"), GradientMap: texture(gradient + 1, "grad.xbm") }),
    chunk(3, "metal_base", {})], archive),
];

describe("preview sources from a prepared record", () => {
  test("only the kind's detail slot, every chunk, coverage where the template keeps it (else solid)", () => {
    const source = previewSourceOf(hairParts(), "hair")!;
    expect(source.parts).toHaveLength(1);
    expect(source.parts[0]!.chunks).toEqual([
      { chunk: 0, coverage: { file: `${hex(5)}.png`, sha256: hex(5), depotPath: "base\\hair\\alpha.xbm", channel: 0, cutoff: 0.33, dither: true } },
      { chunk: 2, coverage: { file: `${hex(6)}.png`, sha256: hex(6), depotPath: "base\\hair\\cap_mask.xbm", channel: 0, cutoff: null, dither: false } },
      { chunk: 3, coverage: null }]);
    expect(previewSourceOf([component("skin", 1, [chunk(0, "skin", {})])], "hair")).toBeNull();
    expect(parsePreviewSource(JSON.parse(JSON.stringify(source)))).toEqual(source);
    expect(() => parsePreviewSource({ ...source, parts: [{ ...source.parts[0], file: "../x.glb" }] })).toThrow();
  });
  test("the kind comes from the preview detail an option draws", () => {
    expect(previewKindOf("hair")).toBe("hair");
    expect(previewKindOf("brows")).toBeNull();
    expect(previewKindOf(null)).toBeNull();
  });
});

describe("preview keys", () => {
  test("canonical: the same parts give one key whatever the colour; another winner, reader output or subject gives another", async () => {
    const a = previewSourceOf(hairParts(), "hair")!, recoloured = previewSourceOf(hairParts(undefined, 40), "hair")!;
    const key = await previewKey(a, "subject-1");
    expect(isPreviewKey(key)).toBe(true);
    expect(await previewKey(recoloured, "subject-1")).toBe(key);
    // Field order doesn't matter.
    const reverse = (value: unknown): unknown => Array.isArray(value) ? value.map(reverse) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverse(v)])) : value;
    const reordered = reverse(a) as ChoicePreviewSource;
    expect(await previewKey(reordered, "subject-1")).toBe(key);
    expect(await previewKey(previewSourceOf(hairParts("some_mod.archive"), "hair")!, "subject-1")).not.toBe(key);
    expect(await previewKey({ ...a, parts: [{ ...a.parts[0]!, sha256: hex(9) }] }, "subject-1")).not.toBe(key);
    expect(await previewKey(a, "subject-2")).not.toBe(key);
  });
  test("a turntable strip has its own key; the still's key input is unchanged by it (phase 1 pictures stay valid)", async () => {
    const a = previewSourceOf(hairParts(), "hair")!;
    expect(previewKeyInput(a, "s")).not.toHaveProperty("turntable");
    expect(previewKeyInput(a, "s", "turntable")).toMatchObject({ turntable: TURNTABLE });
    const still = await previewKey(a, "s"), strip = await previewKey(a, "s", "turntable");
    expect(isPreviewKey(strip)).toBe(true);
    expect(strip).not.toBe(still);
    expect(await previewKey(previewSourceOf(hairParts(undefined, 40), "hair")!, "s", "turntable")).toBe(strip);
    // 24 frames of 256 px stay within WebP's 16383-pixel side.
    expect(TURNTABLE.frames * PREVIEW_STYLES.hair.size).toBeLessThanOrEqual(16383);
  });
});

describe("theming", () => {
  const themes: Record<string, PreviewTokens> = {
    light: { subject: [0.78, 0.79, 0.81], ink: [0.2, 0.21, 0.24], shade: 0.72 },
    dark: { subject: [0.33, 0.34, 0.37], ink: [0.83, 0.84, 0.86], shade: 0.62 },
    tinted: { subject: [0.78, 0.79, 0.81], ink: [0.55, 0.3, 0.12], shade: 0.72 },
  };
  test("the colour matrix reproduces the script composite within 1/255 over the channel space", () => {
    for (const tokens of Object.values(themes)) {
      const matrix = previewColourMatrix(tokens);
      let worst = 0;
      for (let f = 0; f <= 255; f += 17) for (let l = 0; l <= 255; l += 15) {
        // A pixel as the renderer writes it: R = f·l, G = (1 − f)·l, B = f.
        const rgba = [Math.round((f * l) / 255), Math.round(((255 - f) * l) / 255), f, 255];
        const a = applyColourMatrix(matrix, rgba), b = compositeChannels(rgba, tokens);
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(a[c]! - b[c]!));
      }
      expect(worst).toBeLessThanOrEqual(1);
    }
  });
  test("pure ink and pure subject land on their token colours (lit) and their shaded colours (dark)", () => {
    const t = themes.light!, m = previewColourMatrix(t);
    expect(applyColourMatrix(m, [255, 0, 255, 255])).toEqual(t.ink.map(v => Math.round(v * 255)) as [number, number, number]);
    expect(applyColourMatrix(m, [0, 255, 0, 255])).toEqual(t.subject.map(v => Math.round(v * 255)) as [number, number, number]);
    expect(applyColourMatrix(m, [0, 0, 255, 255])).toEqual(t.ink.map(v => Math.round(v * t.shade * 255)) as [number, number, number]);
  });
});

describe("the row's camera", () => {
  const head = { min: [-0.1, 1.5, -0.12] as [number, number, number], max: [0.1, 1.8, 0.1] as [number, number, number] };
  test("aims below the head's centre, frames the style's extent, and faces where the eyes are", () => {
    const style = PREVIEW_STYLES.hair;
    const front = previewCamera(head, { min: [-0.05, 1.7, 0.08], max: [0.05, 1.72, 0.1] }, { ...style, yaw: 0, elevation: 0 });
    expect(front.target[1]).toBeCloseTo(1.65 - style.drop * 0.3, 6);
    expect(front.eye[2]).toBeGreaterThan(1);
    expect(Math.abs(front.eye[0])).toBeLessThan(1e-9);
    const back = previewCamera(head, { min: [-0.05, 1.7, -0.14], max: [0.05, 1.72, -0.12] }, { ...style, yaw: 0, elevation: 0 });
    expect(back.eye[2]).toBeLessThan(-1);
    // The frame's vertical extent at the target's distance is `extent` head heights.
    const distance = Math.hypot(front.eye[0] - front.target[0], front.eye[1] - front.target[1], front.eye[2] - front.target[2]);
    expect(2 * distance * Math.tan((style.fov * Math.PI) / 360)).toBeCloseTo(style.extent * 0.3, 6);
    const turned = previewCamera(head, { min: [-0.05, 1.7, 0.08], max: [0.05, 1.72, 0.1] }, style);
    expect(turned.eye[1]).toBeGreaterThan(turned.target[1]);
    expect(Math.abs(turned.eye[0] - turned.target[0])).toBeGreaterThan(0.1);
  });
  test("turntable frames turn about the head's vertical axis: frame 0 is the still, half a turn looks from behind, the target and height stay", () => {
    const style = PREVIEW_STYLES.hair, eyes = { min: [-0.05, 1.7, 0.08] as [number, number, number], max: [0.05, 1.72, 0.1] as [number, number, number] };
    const still = previewCamera(head, eyes, style), first = previewCamera(head, eyes, style, turntableYaw(0));
    expect([...first.view]).toEqual([...still.view]);
    const half = previewCamera(head, eyes, style, turntableYaw(TURNTABLE.frames / 2));
    expect(half.target).toEqual(still.target);
    expect(half.eye[1]).toBeCloseTo(still.eye[1], 9);
    // Opposite side of the head: the horizontal offset from the target flips.
    expect(half.eye[0] - half.target[0]).toBeCloseTo(-(still.eye[0] - still.target[0]), 9);
    expect(half.eye[2] - half.target[2]).toBeCloseTo(-(still.eye[2] - still.target[2]), 9);
    expect(turntableYaw(1)).toBe(360 / TURNTABLE.frames);
  });
});

describe("the host store", () => {
  const webp = new Uint8Array([...new TextEncoder().encode("RIFF"), 8, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8L"), 0, 0, 0, 0]);
  test("keeps WebP images by key, refuses other bytes and keys, and clears", () => {
    const root = mkdtempSync(join(tmpdir(), "xfs-previews-"));
    try {
      const store = new ChoicePreviewStore(root);
      expect(store.putImage(hex(1), webp)).toBe(true);
      expect(readFileSync(store.imagePath(hex(1))!)).toEqual(Buffer.from(webp));
      expect(store.putImage(hex(2), new Uint8Array(40))).toBe(false);
      expect(store.putImage("../escape", webp)).toBe(false);
      expect(store.imagePath("zz")).toBeNull();
      expect(store.bytes()).toBe(webp.byteLength);
      expect(store.clear().freed).toBe(webp.byteLength);
      expect(store.imagePath(hex(1))).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("a source is reused only while its choice's manifest is unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "xfs-previews-"));
    try {
      const manifests = join(root, "choices"), key = "a".repeat(40);
      require("node:fs").mkdirSync(manifests);
      writeFileSync(join(manifests, `${key}.json`), "{}");
      const stamp = manifestStamp(manifests, key)!;
      const source = previewSourceOf(hairParts(), "hair")!;
      new ChoicePreviewStore(root).setSource(key, stamp, source);
      // A new store (a later session) reads it back from disk.
      expect(new ChoicePreviewStore(root).source(key, stamp)).toEqual(source);
      new ChoicePreviewStore(root).setSource("b".repeat(40), stamp, null);
      expect(new ChoicePreviewStore(root).source("b".repeat(40), stamp)).toBeNull();
      // The choice prepared again: another stamp, so the source is unknown.
      writeFileSync(join(manifests, `${key}.json`), "{\"x\":1}");
      utimesSync(join(manifests, `${key}.json`), new Date(), new Date(Date.now() + 5000));
      expect(new ChoicePreviewStore(root).source(key, manifestStamp(manifests, key)!)).toBeUndefined();
      expect(manifestStamp(manifests, "c".repeat(40))).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("the preview endpoint", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-previews-"));
  const store = new ChoicePreviewStore(root);
  const asked: unknown[] = [];
  const handler = createChoicePreviewHandler({ previews: store, previewSources: async input => { asked.push(input); return input.positions.map(position => ({ position, state: "unprepared" as const })); } });
  const webp = new Uint8Array([...new TextEncoder().encode("RIFF"), 8, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8L"), 0, 0, 0, 0]);
  const at = (path = "") => `http://127.0.0.1/api/preview-character/creator/previews${path}`;
  test("stores and serves images only from the local page", async () => {
    expect((await handler(new Request(at(`/${hex(3)}`)))).status).toBe(404);
    const put = await handler(new Request(at(`/${hex(3)}`), { method: "POST", headers: { "Content-Type": "image/webp", Origin: "http://127.0.0.1" }, body: webp }));
    expect(put.status).toBe(200);
    const got = await handler(new Request(at(`/${hex(3)}`)));
    expect(got.headers.get("Content-Type")).toBe("image/webp");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(webp);
    expect((await handler(new Request(at(`/${hex(4)}`), { method: "POST", headers: { "Content-Type": "image/webp", Origin: "http://evil.example" }, body: webp }))).status).toBe(403);
    expect((await handler(new Request(at(`/${hex(4)}`), { method: "POST", headers: { "Content-Type": "image/png", Origin: "http://127.0.0.1" }, body: webp }))).status).toBe(400);
    expect((await handler(new Request("http://localhost/api/preview-character/creator/previews/" + hex(3)))).status).toBe(403);
    expect((await handler(new Request(at("/not-a-key")))).status).toBe(400);
  });
  test("answers sources for a row, validating the question", async () => {
    const post = (body: unknown) => handler(new Request(at(), { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1" }, body: JSON.stringify(body) }));
    const ok = await post({ request: DEFAULT_CHARACTER, option: "head/hairstyle", kind: "hair", positions: [0, 3], derive: 3 });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ schema: "xfs/choice-preview-sources-1", items: [{ position: 0, state: "unprepared" }, { position: 3, state: "unprepared" }] });
    expect(asked.at(-1)).toMatchObject({ option: "head/hairstyle", kind: "hair", positions: [0, 3], derive: 3 });
    expect((await post({ request: DEFAULT_CHARACTER, option: "head/hairstyle", kind: "brows", positions: [0] })).status).toBe(400);
    expect((await post({ request: DEFAULT_CHARACTER, option: "head/hairstyle", kind: "hair", positions: [-1] })).status).toBe(400);
  });
});

describe("the preview service's scheduling", () => {
  const source = previewSourceOf(hairParts(), "hair")!;
  /** Each position's own source (its geometry's hash names it), so the log says which choice is drawn. */
  const sourceAt = (position: number): ChoicePreviewSource => ({ ...source, parts: [{ ...source.parts[0]!, sha256: hex(200 + position) }] });
  const positionOf = (drawn: ChoicePreviewSource) => Number.parseInt(drawn.parts[0]!.sha256, 16) - 200;
  function harness(options: { ready?: (position: number) => boolean } = {}) {
    const log: string[] = [];
    const waiting: { resolve(): void }[] = [];
    const gate = () => new Promise<void>(resolve => waiting.push({ resolve }));
    const port: ChoicePreviewPort = {
      async sources(_request, _option, _kind, positions, derive) {
        log.push(derive === null ? `lookup ${positions.join(",")}` : `derive ${derive}`);
        await gate();
        return positions.map(position => position === 9 ? { position, state: "none" as const }
          : derive === null && position !== 1 ? { position, state: "unprepared" as const } : { position, state: "ready" as const, source: sourceAt(position) });
      },
      async subject() { return "subject"; },
      async stored() { return null; },
      async render(drawn, _key, frames) { log.push(`${frames ? `spin(${frames})` : "draw"} p${positionOf(drawn)}`); await gate(); return { url: `blob:${log.length}` }; },
    };
    let changes = 0;
    const service = new ChoicePreviewService(port, () => { changes++; });
    const ask = (over: Partial<PreviewAsk> = {}): PreviewAsk => ({ option: "head/hairstyle", kind: "hair", request: DEFAULT_CHARACTER, body: "female", positions: [4, 5, 6, 1, 9],
      selected: 1, focus: null, ready: options.ready ?? (() => true), busy: false, ...over });
    const settle = async () => { for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 0)); const next = waiting.shift(); if (next) next.resolve(); } };
    return { log, service, ask, settle, changes: () => changes };
  }
  test("looks up ready choices, derives in priority order (chosen, then pointer, then view order), draws as sources arrive", async () => {
    const h = harness();
    h.service.update(h.ask({ focus: 6 }));
    await h.settle();
    // The chosen (1) and pointer (6) first, then view order; only choice 1 was indexed, so it draws while the rest are derived.
    expect(h.log[0]).toBe("lookup 1,6,4,5,9");
    expect(h.log.indexOf("derive 6")).toBeLessThan(h.log.indexOf("derive 4"));
    expect(h.log.indexOf("derive 4")).toBeLessThan(h.log.indexOf("derive 5"));
    expect(h.log.some(line => line.startsWith("draw"))).toBe(true);
    const row = h.service.row("head/hairstyle")!;
    expect(row.none.has(9)).toBe(true);
    expect(row.urls.size).toBeGreaterThan(0);
  });
  test("every choice shown is looked up, only ready ones are derived; nothing new starts while a person's change is prepared", async () => {
    const h = harness({ ready: position => position === 4 });
    h.service.update(h.ask({ busy: true }));
    await h.settle();
    expect(h.log).toEqual([]);
    h.service.update(h.ask());
    await h.settle();
    expect(h.log[0]).toBe("lookup 1,4,5,6,9");
    expect(h.log).toContain("derive 4");
    expect(h.log.join(" ")).not.toContain("derive 5");
  });
  test("a job already started finishes when priorities change (another row opens) and its picture is kept", async () => {
    const h = harness();
    h.service.update(h.ask({ positions: [1], selected: null }));
    await new Promise(r => setTimeout(r, 0));
    // The lookup for row A is in flight; row B opens.
    h.service.update(h.ask({ option: "head/other", positions: [7], selected: null }));
    await h.settle();
    expect(h.service.row("head/hairstyle")!.urls.has(1)).toBe(true);
  });
  test("a turntable is drawn only for the wanted choice, after the chosen and hovered stills and before the rest of the row", async () => {
    const h = harness();
    h.service.update(h.ask({ positions: [1, 4], focus: null }));
    await h.settle();
    // Nobody wants a spin: no strip is drawn.
    expect(h.log.some(line => line.startsWith("spin"))).toBe(false);
    const drawn = h.log.filter(line => line.startsWith("draw")).length;
    // The pointer rests on 5 (a new choice): its still first (it is the hovered one), then its strip, then the rest.
    h.service.update(h.ask({ positions: [1, 4, 5, 6], focus: 5, spin: 5 }));
    await h.settle();
    const after = h.log.slice(h.log.findIndex(line => line === "lookup 5,6") + 1).filter(line => !line.startsWith("derive"));
    expect(after.slice(0, 3)).toEqual(["draw p5", "spin(24) p5", "draw p6"]);
    expect(h.log.filter(line => line.startsWith("spin"))).toHaveLength(1);
    const row = h.service.row("head/hairstyle")!;
    expect(row.spins.has(5)).toBe(true);
    expect(row.spins.has(6)).toBe(false);
    expect(row.frames).toBe(TURNTABLE.frames);
    expect(h.service.stats.spun).toBe(1);
    expect(h.service.stats.spinWaitMs).toHaveLength(1);
    expect(drawn).toBeGreaterThan(0);
    // Asked again, nothing is redrawn.
    h.service.update(h.ask({ positions: [1, 4, 5, 6], focus: 5, spin: 5 }));
    await h.settle();
    expect(h.log.filter(line => line.startsWith("spin"))).toHaveLength(1);
  });
  test("a turntable already started finishes and is kept when the pointer moves on", async () => {
    const h = harness();
    h.service.update(h.ask({ positions: [1], selected: 1 }));
    await h.settle();
    h.service.update(h.ask({ positions: [1], selected: 1, spin: 1 }));
    // The strip is being drawn; the pointer leaves.
    h.service.update(h.ask({ positions: [1], selected: 1, spin: null }));
    await h.settle();
    expect(h.service.row("head/hairstyle")!.spins.has(1)).toBe(true);
  });
  test("a stored strip is used without drawing", async () => {
    const log: string[] = [];
    const port: ChoicePreviewPort = {
      async sources(_r, _o, _k, positions) { return positions.map(position => ({ position, state: "ready" as const, source })); },
      async subject() { return "subject"; },
      async stored(key) { return `/stored/${key.slice(0, 4)}`; },
      async render() { log.push("render"); return { url: "blob:x" }; },
    };
    const service = new ChoicePreviewService(port, () => {});
    const ask: PreviewAsk = { option: "o", kind: "hair", request: DEFAULT_CHARACTER, body: "female", positions: [2], selected: null, focus: 2, spin: 2, ready: () => true, busy: false };
    service.update(ask);
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    expect(log).toEqual([]);
    expect(service.row("o")!.spins.get(2)).toStartWith("/stored/");
    expect(service.stats.spinStored).toBe(1);
  });
});

describe("the boundary", () => {
  test("no preview module names an option, a mod, a resource or an archive: producers key on the detail slot and the template table", () => {
    const modules = ["choice-preview.ts", "choice-preview-render.ts", "choice-preview-worker.ts", "choice-preview-service.ts", "choice-preview-host.ts",
      "choice-preview-server.ts", "browser-choice-preview-device.ts", "studio-ui/components/choice-preview.ts"];
    // Option and mod words, and any resource or archive named in a string literal.
    const named = /hairstyle|hair_color|\bhh_|\bccxl\b|\bprc\b|archivexl|["'`][^"'`]*\.(archive|mesh|xbm|mt|app|ent)["'`]/i;
    const found = modules.flatMap(module => readFileSync(join(import.meta.dir, "..", "src", module), "utf8").split("\n")
      .filter(line => !/^\s*(\*|\/\/|\/\*)/.test(line) && named.test(line)).map(line => `${module}: ${line.trim()}`));
    expect(found).toEqual([]);
  });
});
