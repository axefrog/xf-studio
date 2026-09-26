// Native texture reader (phase 3): BCn decoding, the `.xbm` layout and its refusals, the served mip, the PNG stream, the worker's texture
// message and the native-first exporter. Synthetic data only; the real-data comparison with WolvenKit is tools/native-texture-oracle.ts.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { depotHash } from "../src/depot-path";
import { archiveExportSource, type ExportAnswer, type ExportRequest, type GameAssetExporter } from "../src/game-asset-export";
import { createNativeFirstExporter, NATIVE_TEXTURE_IDENTITY, NativeTextureDecoders, type TextureDecoder } from "../src/native-texture-export";
import { NativeArchivePool } from "../src/native/archive-reader";
import { bc7Subset, BlockRowDecoder, decodeBlocks } from "../src/native/bcn";
import { readCr2w } from "../src/native/cr2w-reader";
import { DecodeSession } from "../src/native/limits";
import { InProcessDecoder, WorkerDecoder } from "../src/native/native-decode";
import { classifyNativeFailure } from "../src/native/native-errors";
import { decodeTextureFromPool, TEXTURE_READ_LIMITS } from "../src/native/texture-decode";
import { decodeMip, servedMip, textureLayout } from "../src/native/xbm-texture";
import { decodePng, encodePng, encodePngRows } from "../src/png";
import { fakeDecompress, syntheticArchive } from "./fixtures/native-archive";
import { Cr2wBuilder, prop, v } from "./fixtures/native-cr2w";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const tempRoot = () => { const root = mkdtempSync(join(tmpdir(), "xfs-native-texture-")); roots.push(root); return root; };
const texel = (data: Uint8Array, i: number) => [...data.subarray(i * 4, i * 4 + 4)];

/** A BC1 block: two RGB565 colours and 16 2-bit indices. */
function bc1(c0: number, c1: number, indices: number[]): number[] {
  let bits = 0;
  indices.forEach((index, i) => { bits |= index << (i * 2); });
  return [c0 & 255, c0 >> 8, c1 & 255, c1 >> 8, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255];
}
/** A BC4 block: two endpoints and 16 3-bit indices. */
function bc4(e0: number, e1: number, indices: number[]): number[] {
  let bits = 0n;
  indices.forEach((index, i) => { bits |= BigInt(index) << BigInt(i * 3); });
  return [e0, e1, ...Array.from({ length: 6 }, (_, i) => Number((bits >> BigInt(i * 8)) & 255n))];
}
/** A 128-bit block written LSB first from (value, bit count) fields. */
function bits128(fields: [number, number][]): number[] {
  let value = 0n, at = 0n;
  for (const [field, count] of fields) { value |= BigInt(field) << at; at += BigInt(count); }
  expect(at).toBeLessThanOrEqual(128n);
  return Array.from({ length: 16 }, (_, i) => Number((value >> BigInt(i * 8)) & 255n));
}

test("BC7 partition tables keep the specification's invariants", () => {
  for (let p = 0; p < 64; p++) {
    expect(bc7Subset(2, p, 0)).toBe(0);
    expect(bc7Subset(3, p, 0)).toBe(0);
    const three = new Set(Array.from({ length: 16 }, (_, i) => bc7Subset(3, p, i)));
    expect([...three].sort()).toEqual([0, 1, 2]);
    expect(new Set(Array.from({ length: 16 }, (_, i) => bc7Subset(2, p, i))).size).toBe(2);
  }
  // Spot values from the Khronos Data Format Specification 1.3, Tables 114 and 115.
  expect(Array.from({ length: 16 }, (_, i) => bc7Subset(2, 13, i))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
  expect(Array.from({ length: 16 }, (_, i) => bc7Subset(3, 0, i))).toEqual([0, 0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 1, 2, 2, 2, 2]);
});

test("BC1 decodes four- and three-colour blocks as DirectXTex does", () => {
  const four = decodeBlocks("bc1", Uint8Array.from(bc1(0xf800, 0x001f, [0, 1, 2, 3, ...Array(12).fill(0)])), 4, 4);
  expect(texel(four, 0)).toEqual([255, 0, 0, 255]);
  expect(texel(four, 1)).toEqual([0, 0, 255, 255]);
  expect(texel(four, 2)).toEqual([170, 0, 85, 255]);
  expect(texel(four, 3)).toEqual([85, 0, 170, 255]);
  const three = decodeBlocks("bc1", Uint8Array.from(bc1(0x001f, 0xf800, [2, 3, ...Array(14).fill(0)])), 4, 4);
  expect(texel(three, 0)).toEqual([128, 0, 128, 255]);
  expect(texel(three, 1)).toEqual([0, 0, 0, 0]);
  expect(new BlockRowDecoder("bc1", Uint8Array.from(bc1(0x001f, 0xf800, [2, 3, ...Array(14).fill(0)])), 4, 4).hasAlpha()).toBe(true);
  expect(new BlockRowDecoder("bc1", Uint8Array.from(bc1(0xf800, 0x001f, Array(16).fill(3))), 4, 4).hasAlpha()).toBe(false);
});

test("BC4 is grey and truncates; BC5 keeps blue at 0", () => {
  // 189, 42, index 2: the weighted sum is 168 exactly, and WolvenKit's PNG holds 167 (single precision, truncated).
  const grey = decodeBlocks("bc4", Uint8Array.from(bc4(189, 42, [2, 0, 1, 7, ...Array(12).fill(0)])), 4, 4);
  expect(texel(grey, 0)).toEqual([167, 167, 167, 255]);
  expect(texel(grey, 1)).toEqual([189, 189, 189, 255]);
  expect(texel(grey, 2)).toEqual([42, 42, 42, 255]);
  const six = decodeBlocks("bc4", Uint8Array.from(bc4(10, 200, [6, 7, ...Array(14).fill(0)])), 4, 4);
  expect(texel(six, 0)).toEqual([0, 0, 0, 255]);
  expect(texel(six, 1)).toEqual([255, 255, 255, 255]);
  const normal = decodeBlocks("bc5", Uint8Array.from([...bc4(255, 0, Array(16).fill(0)), ...bc4(0, 255, Array(16).fill(0))]), 4, 4);
  expect(texel(normal, 5)).toEqual([255, 0, 0, 255]);
  expect(new BlockRowDecoder("bc5", new Uint8Array(16), 4, 4).hasAlpha()).toBe(false);
});

test("BC7 mode 6 endpoints, p-bits and weights; a reserved mode decodes to zero", () => {
  // Mode 6: 7 bits of mode, then R0 R1 G0 G1 B0 B1 A0 A1 (7 bits each), P0 P1, then texel 0's index (3 bits) and 15 × 4 bits.
  const block = bits128([[1 << 6, 7], [127, 7], [0, 7], [0, 7], [127, 7], [64, 7], [64, 7], [127, 7], [127, 7], [1, 1], [0, 1], [0, 3], [15, 4], [8, 4]]);
  const out = decodeBlocks("bc7", Uint8Array.from(block), 4, 4);
  expect(texel(out, 0)).toEqual([255, 1, 129, 255]);
  expect(texel(out, 1)).toEqual([0, 254, 128, 254]);
  // Weight 34 of 64 at index 8: ((64 − 34) × e0 + 34 × e1 + 32) >> 6.
  expect(texel(out, 2)).toEqual([(30 * 255 + 34 * 0 + 32) >> 6, (30 * 1 + 34 * 254 + 32) >> 6, (30 * 129 + 34 * 128 + 32) >> 6, (30 * 255 + 34 * 254 + 32) >> 6]);
  expect(new BlockRowDecoder("bc7", Uint8Array.from(block), 4, 4).hasAlpha()).toBe(true);
  expect([...decodeBlocks("bc7", new Uint8Array(16), 4, 4)].every(value => value === 0)).toBe(true);
});

test("block decoding refuses short data and drops edge padding", () => {
  expect(() => decodeBlocks("bc7", new Uint8Array(15), 4, 4)).toThrow(/needs 16 bytes/);
  expect(classifyNativeFailure((() => { try { decodeBlocks("bc1", new Uint8Array(8), 5, 4); } catch (error) { return error; } })())).toBe("malformed");
  const image = decodeBlocks("bc1", Uint8Array.from([...bc1(0xf800, 0, Array(16).fill(0)), ...bc1(0x07e0, 0, Array(16).fill(0))]), 6, 3);
  expect(image.length).toBe(6 * 3 * 4);
  expect(texel(image, 4)).toEqual([0, 255, 0, 255]);
});

test("the streamed PNG is byte-identical to the whole-image encoder", async () => {
  const width = 37, height = 23, data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7919 + (i >> 5)) & 255;
  for (const alpha of [false, true]) {
    const streamed = await encodePngRows(width, height, r => data.subarray(r * width * 4, (r + 1) * width * 4), { alpha, level: 3 });
    expect(Buffer.from(streamed).equals(Buffer.from(encodePng({ width, height, data }, { alpha, level: 3 })))).toBe(true);
  }
});

type TextureOptions = { width: number; height: number; compression?: string; rawFormat?: string; isGamma?: boolean; type?: string; slices?: number;
  mips?: { offset: number; size: number }[]; data: Uint8Array; dataSize?: number; noBlob?: boolean };
/** A `.xbm` resource as the game stores one: `CBitmapTexture`, then its `rendRenderTextureBlobPC` with the data in a deferred buffer. */
function textureResource(o: TextureOptions): Uint8Array {
  const file = new Cr2wBuilder(), buffer = file.buffer(o.data);
  const setup = [...(o.compression ? [prop("compression", "ETextureCompression", v.enum(o.compression))] : []),
    ...(o.rawFormat ? [prop("rawFormat", "ETextureRawFormat", v.enum(o.rawFormat))] : []), ...(o.isGamma ? [prop("isGamma", "Bool", v.bool(true))] : [])];
  file.export("CBitmapTexture", [prop("width", "Uint32", v.u32(o.width * 2)), prop("height", "Uint32", v.u32(o.height * 2)), prop("setup", "STextureGroupSetup", v.struct(setup)),
    ...(o.noBlob ? [] : [prop("renderTextureResource", "rendRenderTextureResource", v.struct([prop("renderResourceBlobPC", "handle:IRenderResourceBlob", v.handle(1))]))])]);
  const mips = o.mips ?? [{ offset: 0, size: o.data.length }];
  file.export("rendRenderTextureBlobPC", [
    prop("header", "rendRenderTextureBlobHeader", v.struct([
      prop("version", "Uint32", v.u32(2)),
      prop("sizeInfo", "rendRenderTextureBlobSizeInfo", v.struct([prop("width", "Uint16", v.u16(o.width)), prop("height", "Uint16", v.u16(o.height))])),
      prop("textureInfo", "rendRenderTextureBlobTextureInfo", v.struct([...(o.type ? [prop("type", "GpuWrapApieTextureType", v.enum(o.type))] : []),
        prop("textureDataSize", "Uint32", v.u32(o.dataSize ?? o.data.length)), prop("sliceSize", "Uint32", v.u32(o.dataSize ?? o.data.length)),
        prop("dataAlignment", "Uint32", v.u32(8)), prop("sliceCount", "Uint16", v.u16(o.slices ?? 1)), prop("mipCount", "Uint8", v.u8(mips.length))])),
      prop("mipMapInfo", "array:rendRenderTextureBlobMipMapInfo", v.array(mips.map(mip => v.struct([
        // A garbage row pitch, as a real microblend has: it is never read.
        prop("layout", "rendRenderTextureBlobMemoryLayout", v.struct([prop("rowPitch", "Uint32", v.u32(595391616))])),
        prop("placement", "rendRenderTextureBlobPlacement", v.struct([prop("offset", "Uint32", v.u32(mip.offset)), prop("size", "Uint32", v.u32(mip.size))]))]))))])),
    prop("textureData", "serializationDeferredDataBuffer", w => { w.u16(buffer + 1); })]);
  return file.build();
}
const layoutOf = (o: TextureOptions) => textureLayout(readCr2w(textureResource(o), fakeDecompress, new DecodeSession(TEXTURE_READ_LIMITS)));

/** An 8×8 BC1 texture with 4 mips: mip 0's top block row red, bottom block row blue; the smaller mips green. */
function mipChain(): TextureOptions {
  const red = bc1(0xf800, 0xf800, Array(16).fill(0)), blue = bc1(0x001f, 0x001f, Array(16).fill(0)), green = bc1(0x07e0, 0x07e0, Array(16).fill(0));
  return { width: 8, height: 8, compression: "TCM_DXTNoAlpha", isGamma: true, data: Uint8Array.from([...red, ...red, ...blue, ...blue, ...green, ...green, ...green]),
    mips: [{ offset: 0, size: 32 }, { offset: 32, size: 8 }, { offset: 40, size: 8 }, { offset: 48, size: 8 }] };
}

test("the texture layout: format from setup, mip 0 from the blob, the served mip, rows in WolvenKit's orientation", () => {
  const layout = layoutOf(mipChain());
  expect(layout.format).toBe("bc1");
  expect(layout.isGamma).toBe(true);
  expect([layout.width, layout.height]).toEqual([8, 8]);
  expect(layout.mips.map(mip => [mip.width, mip.height])).toEqual([[8, 8], [4, 4], [2, 2], [1, 1]]);
  expect(servedMip(layout, 8)).toBe(0);
  expect(servedMip(layout, 4)).toBe(1);
  expect(servedMip(layout, 3)).toBe(2);
  const image = decodeMip(layout, 0);
  // The stored top row (red) is the served image's bottom row.
  expect(texel(image.data, 0)).toEqual([0, 0, 255, 255]);
  expect(texel(image.data, 63)).toEqual([255, 0, 0, 255]);
  expect(texel(decodeMip(layout, 1).data, 0)).toEqual([0, 255, 0, 255]);
  // Raw formats: R8 as grey, R8G8 with blue 0, RGBA8 as stored.
  expect(texel(decodeMip(layoutOf({ width: 1, height: 1, rawFormat: "TRF_Grayscale", data: Uint8Array.from([77]) }), 0).data, 0)).toEqual([77, 77, 77, 255]);
  expect(texel(decodeMip(layoutOf({ width: 1, height: 1, rawFormat: "TRF_R8G8", data: Uint8Array.from([1, 2]) }), 0).data, 0)).toEqual([1, 2, 0, 255]);
  expect(texel(decodeMip(layoutOf({ width: 1, height: 1, data: Uint8Array.from([1, 2, 3, 4]) }), 0).data, 0)).toEqual([1, 2, 3, 4]);
});

test("textures the reader doesn't decode, or that disagree with themselves, are refused with a typed error", () => {
  const kind = (o: TextureOptions) => { try { layoutOf(o); return "ok"; } catch (error) { return classifyNativeFailure(error); } };
  const base = mipChain();
  expect(kind(base)).toBe("ok");
  expect(kind({ ...base, type: "TEXTYPE_3D" })).toBe("unsupported");
  expect(kind({ ...base, type: "TEXTYPE_CUBE" })).toBe("unsupported");
  expect(kind({ ...base, slices: 2 })).toBe("unsupported");
  expect(kind({ ...base, compression: "TCM_HalfHDR_Unsigned" })).toBe("unsupported");
  expect(kind({ width: 1, height: 1, rawFormat: "TRF_HDRFloat", data: new Uint8Array(16) })).toBe("unsupported");
  expect(kind({ ...base, noBlob: true })).toBe("unsupported");
  expect(kind({ ...base, mips: [{ offset: 0, size: 31 }] })).toBe("malformed");
  expect(kind({ ...base, mips: [{ offset: 40, size: 32 }] })).toBe("malformed");
  expect(kind({ ...base, dataSize: 999 })).toBe("malformed");
  expect(kind({ ...base, width: 32768, height: 8 })).toBe("over-budget");
  expect(kind({ ...base, width: 0 })).toBe("malformed");
});

function textureArchive(files: Record<string, Uint8Array>): string {
  const path = join(tempRoot(), "textures.archive");
  writeFileSync(path, syntheticArchive(Object.entries(files).map(([depotPath, bytes]) => ({ path: depotPath, segments: [{ bytes }] }))));
  return path;
}

test("a texture read from an archive becomes the served mip's PNG, in-process and in the worker", async () => {
  const archive = textureArchive({ "base\\t\\chain.xbm": textureResource(mipChain()), "base\\t\\hdr.xbm": textureResource({ width: 1, height: 1, rawFormat: "TRF_HDRFloat", data: new Uint8Array(16) }) });
  const pool = new NativeArchivePool(fakeDecompress);
  const outcome = await decodeTextureFromPool(pool, fakeDecompress, { archivePath: archive, hash: depotHash("base\\t\\chain.xbm"), maxSide: 4 });
  if (!outcome.ok) throw new Error(outcome.message);
  expect([outcome.texture.width, outcome.texture.height, outcome.texture.gameWidth, outcome.texture.mip, outcome.texture.format]).toEqual([4, 4, 8, 1, "bc1"]);
  const png = decodePng(outcome.texture.png);
  expect([png.width, png.height]).toEqual([4, 4]);
  expect(texel(png.data, 0)).toEqual([0, 255, 0, 255]);
  const refused = await decodeTextureFromPool(pool, fakeDecompress, { archivePath: archive, hash: depotHash("base\\t\\hdr.xbm"), maxSide: 4 });
  expect(refused.ok ? "ok" : refused.kind).toBe("unsupported");
  const missing = await decodeTextureFromPool(pool, fakeDecompress, { archivePath: archive, hash: depotHash("base\\t\\none.xbm"), maxSide: 4 });
  expect(missing.ok ? "ok" : missing.kind).toBe("not-indexed");
  const inProcess = new InProcessDecoder(pool, fakeDecompress, { roots: new Set(), identity: "test" }, depotHash);
  expect((await inProcess.decodeTexture({ archivePath: archive, hash: depotHash("base\\t\\chain.xbm"), maxSide: 8 })).ok).toBe(true);
  inProcess.close();
  expect((await inProcess.decodeTexture({ archivePath: archive, hash: depotHash("base\\t\\chain.xbm"), maxSide: 8 })).ok).toBe(false);

  const worker = new WorkerDecoder({ decompressor: { test: "fakeDecompress" }, roots: new Set(), identity: "test", script: new URL("./fixtures/native-decode-test-worker.ts", import.meta.url) });
  try {
    const answered = await worker.decodeTexture({ archivePath: archive, hash: depotHash("base\\t\\chain.xbm"), maxSide: 8 });
    if (!answered.ok) throw new Error(answered.message);
    expect(answered.texture.png).toBeInstanceOf(Uint8Array);
    expect(decodePng(answered.texture.png).width).toBe(8);
    // A document request still works beside it on the same worker.
    const document = await worker.decode({ archivePath: archive, hash: depotHash("base\\t\\chain.xbm"), needName: false });
    expect(document.ok ? "ok" : document.kind).toBe("not-verified");
  } finally { worker.close(); }
});

test("the native-first exporter decodes textures itself, caches them by its identity and hands refusals and geometry to WolvenKit", async () => {
  const archive = textureArchive({ "base\\t\\chain.xbm": textureResource(mipChain()), "base\\t\\hdr.xbm": textureResource({ width: 1, height: 1, rawFormat: "TRF_HDRFloat", data: new Uint8Array(16) }) });
  const cacheRoot = join(tempRoot(), "exports");
  const pngFile = join(tempRoot(), "wk.png");
  writeFileSync(pngFile, encodePng({ width: 1, height: 1, data: Uint8Array.from([9, 9, 9, 255]) }, { alpha: false }));
  const asked: ExportRequest[][] = [];
  const inner: GameAssetExporter = {
    tool: { key: "wk", label: "WolvenKit" },
    open() { throw new Error("not used"); },
    async exportAll(requests) {
      asked.push(requests.map(request => ({ ...request })));
      return requests.map((request): ExportAnswer => ({ geometry: new Map(request.geometry.map(path => [path, { depotPath: path } as never])),
        textures: new Map(request.textures.map(path => [path, { depotPath: path, hash: depotHash(path), png: pngFile, pngSha256: "x", cached: false }])), masks: new Map() }));
    },
  };
  const pool = new NativeArchivePool(fakeDecompress);
  let decodes = 0;
  const decoder: TextureDecoder = { decodeTexture: async request => { decodes++; return decodeTextureFromPool(pool, fakeDecompress, request); } };
  const exporter = createNativeFirstExporter(inner, { cacheRoot, maxSide: 4, decoder: async () => decoder, onFallback: () => {} });
  const source = archiveExportSource(archive, tempRoot());
  const request: ExportRequest = { source, geometry: ["base\\t\\body.mesh"], textures: ["base\\t\\chain.xbm", "base\\t\\hdr.xbm"], masks: [] };
  const [answer] = await exporter.exportAll!([request]);
  const chain = answer!.textures.get("base\\t\\chain.xbm")!;
  expect(chain.cached).toBe(false);
  expect(chain.gameSize).toEqual({ width: 8, height: 8 });
  expect(decodePng(new Uint8Array(await Bun.file(chain.png).arrayBuffer())).width).toBe(4);
  expect(answer!.textures.get("base\\t\\hdr.xbm")!.png).toBe(pngFile);
  expect(answer!.geometry.has("base\\t\\body.mesh")).toBe(true);
  // WolvenKit was asked for the geometry (textures removed), then for the refused texture alone.
  expect(asked.map(run => run.map(item => [item.geometry, item.textures]))).toEqual([[[["base\\t\\body.mesh"], []]], [[[], ["base\\t\\hdr.xbm"]]]]);
  expect(exporter.nativeTextures).toMatchObject({ decoded: 1, fellBack: 1, byKind: { unsupported: 1 } });
  expect(exporter.has!("textures", "base\\t\\chain.xbm", source)).toBe(true);

  // A second exporter (a later preparation) is served from the cache without decoding.
  const again = createNativeFirstExporter(inner, { cacheRoot, maxSide: 4, decoder: async () => decoder, onFallback: () => {} });
  const [second] = await again.exportAll!([{ ...request, geometry: [], textures: ["base\\t\\chain.xbm"] }]);
  expect(second!.textures.get("base\\t\\chain.xbm")!.cached).toBe(true);
  expect(decodes).toBe(2);
  // Another served size is another identity: nothing cached for it.
  const larger = createNativeFirstExporter(inner, { cacheRoot, maxSide: 8, decoder: async () => decoder, onFallback: () => {} });
  expect(larger.has!("textures", "base\\t\\chain.xbm", source)).toBe(false);
  expect(NATIVE_TEXTURE_IDENTITY).toMatch(/^xfs-native-texture:\d+$/);

  // No decoder: every texture goes to WolvenKit; a folder source is never read natively.
  const none = createNativeFirstExporter(inner, { cacheRoot: join(tempRoot(), "e2"), maxSide: 4, decoder: async () => null, onFallback: () => {} });
  const [plain] = await none.exportAll!([{ ...request, geometry: [] }]);
  expect(plain!.textures.get("base\\t\\chain.xbm")!.png).toBe(pngFile);
  const folder = createNativeFirstExporter(inner, { cacheRoot: join(tempRoot(), "e3"), maxSide: 4, decoder: async () => decoder, onFallback: () => {} });
  const before = decodes;
  await folder.exportAll!([{ ...request, source: { archivePath: tempRoot(), fingerprint: "f", gameRoot: tempRoot() }, geometry: [] }]);
  expect(decodes).toBe(before);

  // Cancelled between textures.
  const controller = new AbortController();
  controller.abort();
  const cancelled = createNativeFirstExporter(inner, { cacheRoot: join(tempRoot(), "e4"), maxSide: 4, decoder: async () => decoder, onFallback: () => {} });
  await expect(cancelled.exportAll!([{ ...request, geometry: [] }], controller.signal)).rejects.toMatchObject({ code: "cancelled" });
});

test("texture decoders: off with XFS_NATIVE_READER=0, opened once per game folder, retried after a failure that may pass", async () => {
  let opens = 0;
  const decoders = new NativeTextureDecoders({ env: { XFS_NATIVE_READER: "0" }, open: async () => { opens++; return { decoder: null, reason: "x", permanent: false }; } });
  expect(await decoders.get(tempRoot())).toBeNull();
  expect(opens).toBe(0);
  const fake = { identity: "t", decode: async () => ({ ok: false as const, kind: "unavailable" as const, message: "" }),
    decodeTexture: async () => ({ ok: false as const, kind: "unavailable" as const, message: "" }), close() {} };
  const opened = new NativeTextureDecoders({ env: {}, open: async () => { opens++; return { decoder: fake }; } });
  const root = tempRoot();
  expect(await opened.get(root)).toBe(fake);
  expect(await opened.get(root)).toBe(fake);
  expect(opens).toBe(1);
  const failing = new NativeTextureDecoders({ env: {}, open: async () => { opens++; return { decoder: null, reason: "busy", permanent: false }; } });
  expect(await failing.get(root)).toBeNull();
  expect(await failing.get(root)).toBeNull();
  expect(opens).toBe(2);
  opened.close();
});

test("mutated textures and random blocks never fail inside the reader", () => {
  let seed = 0x5eed;
  const random = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  const internal: string[] = [];
  const bases = [textureResource(mipChain()), textureResource({ width: 4, height: 4, compression: "TCM_QualityColor", data: new Uint8Array(16).fill(0x40) })];
  for (let n = 0; n < 3000; n++) {
    const bytes = bases[n % bases.length]!.slice();
    for (let k = 1 + Math.floor(random() * 4); k > 0; k--) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
    try {
      const layout = textureLayout(readCr2w(bytes, fakeDecompress, new DecodeSession(TEXTURE_READ_LIMITS)));
      decodeMip(layout, servedMip(layout, 4));
    } catch (error) { if (classifyNativeFailure(error) === "internal") internal.push(String((error as Error).stack ?? error)); }
  }
  for (const format of ["bc1", "bc3", "bc4", "bc5", "bc7"] as const) {
    const blocks = Uint8Array.from({ length: 16 * 64 }, () => Math.floor(random() * 256));
    const rows = new BlockRowDecoder(format, blocks, 32, 32);
    rows.hasAlpha();
    expect(decodeBlocks(format, blocks, 32, 32).length).toBe(32 * 32 * 4);
  }
  expect(internal.slice(0, 3)).toEqual([]);
});
