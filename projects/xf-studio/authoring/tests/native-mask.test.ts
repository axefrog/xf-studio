/**
 * XF Studio's layer mask reader (src/native/mlmask.ts, PREV-190): the BC4 atlas as WolvenKit's mask decoder reads it, the tiled layers
 * against a plain per-texel transcription of WolvenKit 9.0.1's exporter on random masks, a mask read from an archive to PNGs, and the
 * native-first exporter answering masks itself (cached by its own identity, two lanes, refusals to WolvenKit). The real-data oracle is
 * `tools/native-mask-oracle.ts` (every mask WolvenKit exported into a cache, texel for texel).
 */
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { depotHash } from "../src/depot-path";
import { archiveExportSource, type ExportAnswer, type ExportRequest, type GameAssetExporter } from "../src/game-asset-export";
import { createNativeFirstExporter, NATIVE_MASK_IDENTITY, type TextureDecoder } from "../src/native-texture-export";
import { NativeArchivePool } from "../src/native/archive-reader";
import { decodeMaskAtlas, decodeMaskLayers, type MaskLayout } from "../src/native/mlmask";
import { InProcessDecoder, WorkerDecoder } from "../src/native/native-decode";
import { decodeMaskFromPool } from "../src/native/texture-decode";
import { decodePng } from "../src/png";
import { evictPrepared, STALE_WORK_MS, sweepStaleWork } from "../src/prepared-files";
import { fakeDecompress, syntheticArchive } from "./fixtures/native-archive";
import { Cr2wBuilder, prop, v } from "./fixtures/native-cr2w";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const tempRoot = () => { const root = mkdtempSync(join(tmpdir(), "xfs-native-mask-")); roots.push(root); return root; };

/** One BC4 block: endpoints and 16 three-bit indices (texel 0 first). */
const bc4 = (e0: number, e1: number, indices: number[]) => {
  const block = new Uint8Array(8);
  block[0] = e0; block[1] = e1;
  let bits = 0n;
  indices.forEach((index, texel) => { bits |= BigInt(index) << BigInt(3 * texel); });
  for (let i = 0; i < 6; i++) block[2 + i] = Number((bits >> BigInt(8 * i)) & 0xffn);
  return block;
};

test("the atlas's BC4 levels are WolvenKit's mask decoder's: single precision, divided by 7 or 5, truncated", () => {
  const down = decodeMaskAtlas(bc4(255, 0, [0, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0]), 4, 4);
  expect([...down.slice(0, 8)]).toEqual([255, 0, 218, 182, 145, 109, 72, 36]);
  const up = decodeMaskAtlas(bc4(0, 255, [0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7]), 4, 4);
  expect([...up.slice(0, 8)]).toEqual([0, 255, 51, 102, 153, 204, 0, 255]);
  // Texel 5 of a block sits in its second row, second column.
  const placed = decodeMaskAtlas(Uint8Array.from([...bc4(0, 200, Array(16).fill(0)), ...bc4(0, 200, [0, 0, 0, 0, 0, 1, ...Array(10).fill(0)])]), 8, 4);
  expect(placed[1 * 8 + 4 + 1]).toBe(200);
});

/** WolvenKit 9.0.1's exporter (MlmaskTools.DecodeLayerBuffers), transcribed texel by texel, as the reference. */
function reference(layout: MaskLayout) {
  const { width, height, widthLow, heightLow, tileSize, atlasWidth } = layout;
  const atlas = decodeMaskAtlas(layout.atlas(), layout.atlasWidth, layout.atlasHeight), tiles = layout.tiles();
  const ceil = (a: number, b: number) => Math.floor((a + b - 1) / b), bits = (n: number) => n.toString(2).split("").filter(c => c === "1").length;
  const smallOffset = ceil(width, tileSize) * ceil(height, tileSize), smallScale = widthLow === 0 || width < widthLow ? 1 : Math.floor(width / widthLow);
  const out: { width: number; height: number; pixels: number[] }[] = [];
  for (let layer = 0; layer < layout.layers; layer++) {
    const full = new Array<number>(width * height).fill(0);
    const single = (x: number, y: number, offset: number, scale: number, across: number) => {
      const tile = across * Math.floor(Math.floor(y / tileSize) / scale) + Math.floor(Math.floor(x / tileSize) / scale) + offset;
      if (tile * 2 + 1 >= tiles.length) return false;
      const at = tiles[tile * 2]!, present = tiles[tile * 2 + 1]!;
      if (!(present & (1 << layer))) return false;
      const extra = bits(present & ((1 << layer) - 1));
      if (at + extra >= tiles.length) return false;
      const d = tiles[at + extra]!;
      const lx = Math.min((x >>> ((d >>> 20) & 15)) % tileSize, tileSize - 1), ly = Math.min((y >>> ((d >>> 24) & 15)) % tileSize, tileSize - 1);
      const index = lx + 1 + (d & 1023) * (tileSize + 2) + (ly + 1 + ((d >>> 10) & 1023) * (tileSize + 2)) * atlasWidth;
      if (index >= atlas.length) return false;
      full[x + y * width] = atlas[index]!;
      return true;
    };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
      if (!single(x, y, 0, 1, ceil(width, tileSize))) single(x, y, smallOffset, smallScale, ceil(Math.floor(width / smallScale), tileSize));
    let high = false;
    for (let t = 0; t < smallOffset; t++) if (t * 2 + 1 < tiles.length && tiles[t * 2 + 1]! & (1 << layer)) high = true;
    if (high || widthLow === 0 || heightLow === 0 || widthLow === width) { out.push({ width, height, pixels: full }); continue; }
    const small: number[] = [];
    for (let y = 0; y < heightLow; y++) for (let x = 0; x < widthLow; x++)
      small.push(full[Math.min(width - 1, Math.trunc(x * (width / widthLow))) + Math.min(height - 1, Math.trunc(y * (height / heightLow))) * width]!);
    out.push({ width: widthLow, height: heightLow, pixels: small });
  }
  return out;
}

/** A random mask: a tile table over a full and a low-resolution grid, each tile holding a random set of layers, over a random atlas. */
function randomMask(seed: number): MaskLayout {
  let state = seed;
  const random = (n: number) => { state = (state * 1103515245 + 12345) >>> 0; return state % n; };
  const tileSize = [4, 6, 8][random(3)]!, across = 1 + random(3), down = 1 + random(3), layers = 1 + random(6);
  const width = across * tileSize - random(2), height = down * tileSize, scale = [1, 2][random(2)]!;
  const widthLow = random(4) === 0 ? 0 : Math.floor(width / scale), heightLow = widthLow ? Math.floor(height / scale) : 0;
  const atlasTiles = 3, atlasSide = atlasTiles * (tileSize + 2);
  const atlasWidth = atlasSide % 4 ? atlasSide * 2 : atlasSide, atlasHeight = atlasWidth;
  const atlas = new Uint8Array((atlasWidth / 4) * (atlasHeight / 4) * 8);
  for (let i = 0; i < atlas.length; i++) atlas[i] = random(256);
  const fullTiles = Math.ceil(width / tileSize) * Math.ceil(height / tileSize);
  const lowScale = widthLow === 0 || width < widthLow ? 1 : Math.floor(width / widthLow);
  const lowTiles = Math.ceil(Math.floor(width / lowScale) / tileSize) * Math.ceil(Math.floor(height / lowScale) / tileSize);
  const grid: number[] = [], declarations: number[] = [];
  const header = (fullTiles + lowTiles) * 2;
  for (let tile = 0; tile < fullTiles + lowTiles; tile++) {
    let present = 0;
    for (let layer = 0; layer < layers; layer++) if (random(3) === 0) present |= 1 << layer;
    grid.push(header + declarations.length, present);
    for (let layer = 0; layer < layers; layer++) if (present & (1 << layer))
      declarations.push(random(atlasTiles) | (random(atlasTiles) << 10) | (random(2) << 20) | (random(2) << 24));
  }
  const tiles = Uint32Array.from([...grid, ...declarations]);
  return { atlasWidth, atlasHeight, layers, width, height, widthLow, heightLow, tileSize, atlas: () => atlas, tiles: () => tiles };
}

test("the tiled layers equal WolvenKit's per-texel exporter on random masks (full, low-resolution and empty layers)", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const layout = randomMask(seed);
    const mine = decodeMaskLayers(layout).map(layer => ({ width: layer.width, height: layer.height, pixels: [...layer.pixels] }));
    expect(mine).toEqual(reference(layout));
  }
});

/** A `Multilayer_Mask` resource: 8×4, tiles of 4 in a 12×12 atlas; layer 0 full-size, layer 1 low-resolution only (4×2). */
function maskResource(options: { tileSize?: number } = {}): Uint8Array {
  const tileSize = options.tileSize ?? 4;
  // The atlas's 3×3 blocks: every texel 10 (index 0) except the second atlas tile across (texels 6–11) 20 (index 1), and the second
  // down 255 (index 7, which is 1 when e0 ≤ e1).
  const blocks: Uint8Array[] = [];
  for (let by = 0; by < 3; by++) for (let bx = 0; bx < 3; bx++) {
    const indices = Array.from({ length: 16 }, (_, t) => { const x = bx * 4 + (t & 3), y = by * 4 + (t >> 2); return y >= 6 ? 2 : x >= 6 ? 1 : 0; });
    blocks.push(bc4(10, 20, indices.map(i => i === 2 ? 7 : i)));
  }
  const atlas = Uint8Array.from(blocks.flatMap(block => [...block]));
  // Full grid (2 tiles), low grid (1 tile), then declarations: layer 0 of full tile 0 → atlas (0,0), of full tile 1 → (1,0); layer 1 of the
  // low tile → (0,1) with its texels scaled by 2 both ways.
  const tiles = Uint32Array.from([6, 1, 7, 1, 8, 2, 0, 1, 0 | (1 << 10) | (1 << 20) | (1 << 24)]);
  const tileBytes = new Uint8Array(tiles.buffer);
  const file = new Cr2wBuilder(), atlasBuffer = file.buffer(atlas), tilesBuffer = file.buffer(tileBytes);
  file.export("Multilayer_Mask", [prop("renderResourceBlob", "rendRenderMultilayerMaskResource", v.struct([prop("renderResourceBlobPC", "handle:IRenderResourceBlob", v.handle(1))]))]);
  file.export("rendRenderMultilayerMaskBlobPC", [
    prop("header", "rendRenderMultilayerMaskBlobHeader", v.struct([prop("version", "Uint32", v.u32(3)), prop("atlasWidth", "Uint32", v.u32(12)),
      prop("atlasHeight", "Uint32", v.u32(12)), prop("numLayers", "Uint32", v.u32(2)), prop("maskWidth", "Uint32", v.u32(8)), prop("maskHeight", "Uint32", v.u32(4)),
      prop("maskWidthLow", "Uint32", v.u32(4)), prop("maskHeightLow", "Uint32", v.u32(2)), prop("maskTileSize", "Uint32", v.u32(tileSize))])),
    prop("atlasData", "serializationDeferredDataBuffer", w => { w.u16(atlasBuffer + 1); }),
    prop("tilesData", "serializationDeferredDataBuffer", w => { w.u16(tilesBuffer + 1); })]);
  return file.build();
}
function maskArchive(files: Record<string, Uint8Array>): string {
  const path = join(tempRoot(), "masks.archive");
  writeFileSync(path, syntheticArchive(Object.entries(files).map(([depotPath, bytes]) => ({ path: depotPath, segments: [{ bytes }] }))));
  return path;
}

test("a mask read from an archive becomes one PNG per layer, in-process and in the worker; a damaged one is refused as malformed", async () => {
  const archive = maskArchive({ "base\\m\\hair.mlmask": maskResource(), "base\\m\\bad.mlmask": maskResource({ tileSize: 0 }) });
  const pool = new NativeArchivePool(fakeDecompress);
  const outcome = await decodeMaskFromPool(pool, fakeDecompress, { archivePath: archive, hash: depotHash("base\\m\\hair.mlmask") });
  if (!outcome.ok) throw new Error(outcome.message);
  const [layer0, layer1] = outcome.mask.layers.map(layer => decodePng(layer.png));
  expect([layer0!.width, layer0!.height, layer1!.width, layer1!.height]).toEqual([8, 4, 4, 2]);
  const red = (image: typeof layer0, x: number, y: number) => image!.data[(y * image!.width + x) * 4];
  // Layer 0: the first tile reads atlas tile (0,0) (10), the second atlas tile (1,0) (20).
  expect([red(layer0, 0, 0), red(layer0, 3, 3), red(layer0, 4, 0), red(layer0, 7, 3)]).toEqual([10, 10, 20, 20]);
  // Layer 1: the low-resolution tile, atlas tile (0,1).
  expect(red(layer1, 0, 0)).toBe(255);
  expect(outcome.mask.extractedSha256).toMatch(/^[0-9a-f]{64}$/);
  const bad = await decodeMaskFromPool(pool, fakeDecompress, { archivePath: archive, hash: depotHash("base\\m\\bad.mlmask") });
  expect(bad.ok ? "ok" : bad.kind).toBe("malformed");
  const inProcess = new InProcessDecoder(pool, fakeDecompress, { roots: new Set(), identity: "test" }, depotHash);
  expect((await inProcess.decodeMask({ archivePath: archive, hash: depotHash("base\\m\\hair.mlmask") })).ok).toBe(true);
  inProcess.close();
  // The decode worker answers it too, its PNGs moved to the host.
  const worker = new WorkerDecoder({ decompressor: { test: "fakeDecompress" }, roots: new Set(), identity: "test",
    script: new URL("./fixtures/native-decode-test-worker.ts", import.meta.url) });
  try {
    const answered = await worker.decodeMask({ archivePath: archive, hash: depotHash("base\\m\\hair.mlmask") });
    if (!answered.ok) throw new Error(answered.message);
    expect(answered.mask.layers.map(layer => decodePng(layer.png).width)).toEqual([8, 4]);
  } finally { worker.close(); }
});

test("the native-first exporter reads masks itself on two lanes, caches them by its own identity and hands refusals to WolvenKit", async () => {
  const archive = maskArchive({ "base\\m\\hair.mlmask": maskResource(), "base\\m\\bad.mlmask": maskResource({ tileSize: 0 }),
    "base\\m\\other.mlmask": maskResource() });
  const cacheRoot = join(tempRoot(), "exports"), layerFile = join(tempRoot(), "wk-layer.png");
  writeFileSync(layerFile, "png");
  const asked: ExportRequest[][] = [];
  const inner: GameAssetExporter = {
    tool: { key: "wk", label: "WolvenKit" },
    open() { throw new Error("not used"); },
    async exportAll(requests) {
      asked.push(requests.map(request => ({ ...request })));
      return requests.map((request): ExportAnswer => ({ geometry: new Map(), textures: new Map(),
        masks: new Map(request.masks.map(path => [path, { depotPath: path, hash: depotHash(path), layers: [layerFile], cached: false }])) }));
    },
  };
  const pool = new NativeArchivePool(fakeDecompress);
  const used = new Set<number>();
  const decoderFor = (lane: number): TextureDecoder => ({ decodeMask: async request => {
    used.add(lane);
    await Bun.sleep(5);
    return decodeMaskFromPool(pool, fakeDecompress, request);
  } });
  const exporter = createNativeFirstExporter(inner, { cacheRoot, maxSide: 4, decoder: async (_, lane) => decoderFor(lane), lanes: () => 2, onFallback: () => {} });
  const source = archiveExportSource(archive, tempRoot());
  const request: ExportRequest = { source, geometry: [], textures: [], masks: ["base\\m\\hair.mlmask", "base\\m\\bad.mlmask", "base\\m\\other.mlmask"] };
  const [answer] = await exporter.exportAll!([request]);
  const hair = answer!.masks.get("base\\m\\hair.mlmask")!;
  expect(hair.cached).toBe(false);
  expect(hair.layers.map(file => decodePng(new Uint8Array(require("node:fs").readFileSync(file))).width)).toEqual([8, 4]);
  expect(answer!.masks.get("base\\m\\bad.mlmask")!.layers).toEqual([layerFile]);
  expect([...used].sort()).toEqual([0, 1]);
  // WolvenKit was asked for nothing but the refused mask.
  expect(asked.map(run => run.map(item => item.masks))).toEqual([[[]], [["base\\m\\bad.mlmask"]]]);
  expect(exporter.nativeTextures.masks).toEqual({ decoded: 2, cached: 0, fellBack: 1 });
  expect(exporter.has!("masks", "base\\m\\hair.mlmask", source)).toBe(true);
  // A later preparation is answered from the cache; the identity names the mask reader's rules and the resource reader's.
  const again = createNativeFirstExporter(inner, { cacheRoot, maxSide: 4, decoder: async (_, lane) => decoderFor(lane), onFallback: () => {} });
  const [second] = await again.exportAll!([{ ...request, masks: ["base\\m\\hair.mlmask"] }]);
  expect(second!.masks.get("base\\m\\hair.mlmask")!.cached).toBe(true);
  expect(again.nativeTextures.masks.cached).toBe(1);
  expect(NATIVE_MASK_IDENTITY).toMatch(/^xfs-native-mask:\d+:\d+:[0-9a-f]{12}$/);
});

test("a resource several requests want is decoded once, by one lane, and answers each of them (two lanes once raced to publish it)", async () => {
  const archive = maskArchive({ "base\\m\\hair.mlmask": maskResource(), "base\\m\\other.mlmask": maskResource() });
  const cacheRoot = join(tempRoot(), "exports");
  const inner: GameAssetExporter = { tool: { key: "wk", label: "WolvenKit" }, open() { throw new Error("not used"); },
    async exportAll(requests) { return requests.map((): ExportAnswer => ({ geometry: new Map(), textures: new Map(), masks: new Map() })); } };
  const pool = new NativeArchivePool(fakeDecompress);
  const decoded: string[] = [];
  const decoder: TextureDecoder = { decodeMask: async request => { decoded.push(String(request.hash)); await Bun.sleep(5); return decodeMaskFromPool(pool, fakeDecompress, request); } };
  const exporter = createNativeFirstExporter(inner, { cacheRoot, maxSide: 4, decoder: async () => decoder, lanes: () => 2, onFallback: () => {} });
  const source = archiveExportSource(archive, tempRoot());
  const masks = ["base\\m\\hair.mlmask", "base\\m\\other.mlmask"];
  const answers = await exporter.exportAll!([{ source, geometry: [], textures: [], masks }, { source, geometry: [], textures: [], masks: [...masks].reverse() }]);
  expect(decoded.length).toBe(2);
  for (const answer of answers) for (const path of masks) expect(answer.masks.get(path)!.layers.length).toBe(2);
  expect(answers[0]!.masks.get(masks[0]!)!.layers).toEqual(answers[1]!.masks.get(masks[0]!)!.layers);
});

test("a cancelled export waits for every lane before removing its work folders, so none is left behind (PREV-198)", async () => {
  const archive = maskArchive({ "base\m\a.mlmask": maskResource(), "base\m\b.mlmask": maskResource(), "base\m\c.mlmask": maskResource(),
    "base\m\d.mlmask": maskResource() });
  const cacheRoot = join(tempRoot(), "exports");
  const inner: GameAssetExporter = { tool: { key: "wk", label: "WolvenKit" }, open() { throw new Error("not used"); },
    async exportAll(requests) { return requests.map((): ExportAnswer => ({ geometry: new Map(), textures: new Map(), masks: new Map() })); } };
  const pool = new NativeArchivePool(fakeDecompress);
  // Lane 0 decodes quickly and meets the cancellation between jobs; lane 1 is still decoding then, and writes its work folder after.
  const slow = (ms: number): TextureDecoder => ({ decodeMask: async request => { await Bun.sleep(ms); return decodeMaskFromPool(pool, fakeDecompress, request); } });
  const exporter = createNativeFirstExporter(inner, { cacheRoot, maxSide: 4, decoder: async (_, lane) => slow(lane === 0 ? 20 : 200), lanes: () => 2, onFallback: () => {} });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const masks = ["base\m\a.mlmask", "base\m\b.mlmask", "base\m\c.mlmask", "base\m\d.mlmask"];
  const outcome = await exporter.exportAll!([{ source: archiveExportSource(archive, tempRoot()), geometry: [], textures: [], masks }], controller.signal)
    .then(() => "finished", (error: { code?: string }) => error.code);
  expect(outcome).toBe("cancelled");
  await Bun.sleep(250);
  expect(readdirSync(cacheRoot).filter(name => name.startsWith(".work-"))).toEqual([]);
});

test("work folders left over by a crash are swept once they are an hour old; newer ones are kept (PREV-198)", async () => {
  const exports = tempRoot();
  const old = join(exports, ".work-old"), recent = join(exports, ".work-recent");
  for (const folder of [old, recent]) { mkdirSync(folder); writeFileSync(join(folder, "layer.png"), "png"); }
  const hourAgo = (Date.now() - STALE_WORK_MS - 60_000) / 1000;
  utimesSync(old, hourAgo, hourAgo);
  expect(await sweepStaleWork(exports)).toBe(1);
  expect(readdirSync(exports)).toEqual([".work-recent"]);
  // The budget check sweeps them too, even under budget.
  mkdirSync(old); utimesSync(old, hourAgo, hourAgo);
  await evictPrepared({ exports, resolver: tempRoot(), store: tempRoot(), manifests: tempRoot() }, Infinity);
  expect(readdirSync(exports)).toEqual([".work-recent"]);
});
