// PIPE-130: the native resource writer. Unit checks on synthetic resources (read back with the native reader) run everywhere; the
// oracle block compares the writer with WolvenKit 9.0.1's own output of a real Build byte for byte (tools/native-writer-oracle.ts
// capture), which needs the ignored oracle folder, the game's Oodle (XFS_RESOLVER_GAME_ROOT) and XF Studio's texture compressor.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { readCr2w } from "../src/native/cr2w-reader";
import { readResourceJson } from "../src/native/resource-document";
import { readPackage } from "../src/native/red-package";
import { RedHandle, RedObject } from "../src/native/red-model";
import { parseLxrsNames, parseRdarHeader, RdarIndex } from "../src/native/rdar-archive";
import { loadGameOodle } from "../src/native/oodle";
import { ByteWriter } from "../src/native/write/byte-writer";
import { BCN_GPU, DXGI, loadBcnLibrary, type BcnLibrary } from "../src/native/write/bcn";
import { importFlags, nameHash, writeCr2wDocument, writeCr2wObject, writeVarString } from "../src/native/write/cr2w-writer";
import { depotPathHash, writeAppearancePackage } from "../src/native/write/package-writer";
import { archiveEqualExceptTimes, crc64xz, fileTimeOf, packArchive, walkOrder } from "../src/native/write/rdar-writer";
import { NativeWriteRefusal, propertiesToWrite } from "../src/native/write/red-encoder";
import { karkSegment, LEVEL_OPTIMAL2 } from "../src/native/write/segments";
import { blockLayout, flipLevels, importPlan, importTexture, readDds } from "../src/native/write/xbm-writer";
import { createNativeResourceTools, loadNativeWriterLibraries, NATIVE_WRITER_ORACLES, oracleRefusal, wolvenKitRefusal } from "../src/native-resource-tools";
import { nodeWriterHost } from "../tools/native-writer-host";
import { encodeDds } from "../src/engines/layered-makeup/flat-mip-chain";
import { EYE_MAKEUP_WRITER_ORACLE, TEXTURE_GROUP_SETTINGS } from "../src/package-resource-builder";
import type { ResourceTools, TextureImportSettings } from "../src/platform/api";
import { oracleDescribe } from "./optional-oracles";

const raw = (bytes: Uint8Array) => bytes;
const noDecompress = () => { throw Error("nothing here is compressed"); };
/** A compressor that never helps, so every segment is stored raw. */
const neverSmaller = (input: Uint8Array) => new Uint8Array(input.length + 16);
const cname = (value: string) => ({ $type: "CName", $storage: "string", $value: value });
const ref = (path: string, flags = "Default") => ({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: path }, Flags: flags });
const doc = (root: unknown) => ({ Header: { WKitJsonVersion: "0.0.9", DataType: "CR2W" }, Data: { Version: 195, BuildVersion: 0, RootChunk: root, EmbeddedFiles: [] } });
const SCALAR = Object.fromEntries(TEXTURE_GROUP_SETTINGS)["dds-scalar"]!;
const COLOUR = Object.fromEntries(TEXTURE_GROUP_SETTINGS)["dds-colour"]!;

describe("the writer's rules", () => {
  test("a property equal to its class default is left out, except in classes that write every property", () => {
    // Vector4 writes all four components even at zero (WolvenKit's serialize-default classes).
    expect(propertiesToWrite("Vector4", { $type: "Vector4", X: 0, Y: 0, Z: 0, W: 0 }).map(p => p.name)).toEqual(["X", "Y", "Z", "W"]);
    // A vertex layout's hash defaults to 0xFFFFFFFF, so 0 is written and the default is not.
    const layout = { $type: "GpuWrapApiVertexLayoutDesc", elements: { Elements: [] }, slotStrides: { Elements: [] }, slotMask: 0, hash: 0 };
    expect(propertiesToWrite("GpuWrapApiVertexLayoutDesc", layout).map(p => p.name)).toEqual(["hash"]);
    expect(propertiesToWrite("GpuWrapApiVertexLayoutDesc", { ...layout, hash: 4294967295 })).toEqual([]);
    // A mesh's surface areas default to -1 each; the plate's real ones are written.
    expect(propertiesToWrite("CMesh", { $type: "CMesh", surfaceAreaPerAxis: { $type: "Vector3", X: -1, Y: -1, Z: -1 } })).toEqual([]);
    // Floats compare as float32: a double that rounds to the default is the default.
    expect(propertiesToWrite("entMorphTargetSkinnedMeshComponent", { $type: "entMorphTargetSkinnedMeshComponent", autoHideDistance: 1e-50 })).toEqual([]);
  });

  test("unknown classes and properties are refused rather than guessed", () => {
    expect(() => propertiesToWrite("NotAClass", { $type: "NotAClass" })).toThrow(NativeWriteRefusal);
    expect(() => propertiesToWrite("Vector4", { $type: "Vector4", Q: 1 })).toThrow(NativeWriteRefusal);
    expect(() => writeCr2wDocument(doc({ $type: "CMaterialInstance", baseMaterial: { DepotPath: { $type: "ResourcePath", $storage: "uint64", $value: "123" }, Flags: "Default" } }), raw))
      .toThrow("hash");
    expect(() => writeCr2wDocument({ Header: { DataType: "CR2W" }, Data: { Version: 194, RootChunk: { $type: "CMaterialInstance" } } }, raw)).toThrow("version");
  });

  test("nothing in the input is ignored or wrapped: unknown wrapper keys, material metadata, out-of-range integers, overflowing fields (NATIVE-73)", () => {
    const material = (extra: Record<string, unknown>) => doc({ $type: "CMaterialInstance", resourceVersion: 4, ...extra });
    // Unknown keys inside a reference, its path, a name, a handle and a buffer.
    expect(() => writeCr2wDocument(material({ baseMaterial: { ...ref("base\\a.mt"), Extra: 1 } }), raw)).toThrow("Extra is not a key");
    expect(() => writeCr2wDocument(material({ baseMaterial: { DepotPath: { $type: "ResourcePath", $storage: "string", $value: "base\\a.mt", hash: 1 }, Flags: "Default" } }), raw))
      .toThrow("hash is not a key");
    expect(() => writeCr2wDocument(material({ audioTag: { ...cname("x"), note: "y" } }), raw)).toThrow("note is not a key");
    const mesh = (blob: unknown) => doc({ $type: "CMesh", renderResourceBlob: blob });
    expect(() => writeCr2wDocument(mesh({ HandleId: "1", Data: { $type: "rendRenderMeshBlob" }, Comment: "x" }), raw)).toThrow("Comment is not a key");
    expect(() => writeCr2wDocument(mesh({ HandleId: "1", Data: { $type: "rendRenderMeshBlob",
      renderBuffer: { BufferId: "0", Flags: 0, Bytes: "AQID", Type: "x" } } }), raw)).toThrow("Type is not a key");
    // A wrapper or struct with a stray key is never taken for its default (and so dropped): it is written, and refused there.
    const layout = { $type: "GpuWrapApiVertexLayoutDesc", elements: { Elements: [], Count: 0 } };
    expect(propertiesToWrite("GpuWrapApiVertexLayoutDesc", layout).map(p => p.name)).toContain("elements");
    expect(() => writeCr2wDocument(mesh({ HandleId: "1", Data: { $type: "rendRenderMeshBlob", header: { $type: "rendRenderMeshBlobHeader",
      vertexLayout: layout } } }), raw)).toThrow("rendRenderMeshBlobHeader.vertexLayout is not a property");
    // A material's metadata has no proven encoding; null (its default) is fine.
    expect(() => writeCr2wDocument(material({ metadata: { BufferId: "0", Flags: 0, Bytes: "AQID" } }), raw)).toThrow("metadata is not written");
    expect(Buffer.from(writeCr2wDocument(material({ metadata: null }), raw).subarray(0, 4)).toString()).toBe("CR2W");
    // 64-bit integers outside their range are refused, not wrapped.
    const component = (id: string) => ({ $type: "entMorphTargetSkinnedMeshComponent", name: cname("c"), id });
    const app = (id: string) => doc({ $type: "appearanceAppearanceResource", appearances: [{ HandleId: "0", Data: { $type: "appearanceAppearanceDefinition",
      name: cname("a"), components: [component(id)] } }] });
    expect(() => writeCr2wDocument(app("18446744073709551616"), raw)).toThrow(NativeWriteRefusal);
    expect(() => writeCr2wDocument(app("-1"), raw)).toThrow(NativeWriteRefusal);
    expect(writeCr2wDocument(app("18446744073709551615"), raw).length).toBeGreaterThan(0);
    // Fields too small for their value are refused.
    const out = new ByteWriter();
    expect(() => out.u16(0x10000)).toThrow(NativeWriteRefusal);
    expect(() => out.u32(-1)).toThrow(NativeWriteRefusal);
    expect(() => out.i16(0x8000)).toThrow(NativeWriteRefusal);
    expect(() => out.u64(1n << 64n)).toThrow(NativeWriteRefusal);
    expect(() => out.u8(1.5)).toThrow(NativeWriteRefusal);
    expect(out.length).toBe(0);
    // More imports than a u16 index can name.
    const many = doc({ $type: "CMesh", externalMaterials: Array.from({ length: 0x10000 }, (_, i) => ref(`m_${i}.mi`)) });
    expect(() => writeCr2wDocument(many, raw)).toThrow("doesn't fit a u16");
  });

  test("names hash as folded FNV-1a 64, strings are length-prefixed UTF-8, flags parse", () => {
    const text = new TextEncoder();
    expect(nameHash(text.encode(""))).toBe(0);
    expect(nameHash(text.encode("appearanceAppearanceResource"))).toBe(0x95110607);
    const out = new ByteWriter();
    writeVarString(out, "XF");
    writeVarString(out, "x".repeat(64));
    writeVarString(out, "—");
    expect([...out.toBytes().subarray(0, 3)]).toEqual([0x82, 0x58, 0x46]);
    expect([...out.toBytes().subarray(3, 5)]).toEqual([0xc0, 0x01]);
    expect([...out.toBytes().subarray(69)]).toEqual([0x83, 0xe2, 0x80, 0x94]);
    expect(importFlags("Default")).toBe(0);
    expect(importFlags("Soft")).toBe(4);
    expect(importFlags("Obligatory, Soft")).toBe(5);
    expect(() => importFlags("Sometimes")).toThrow(NativeWriteRefusal);
  });
});

describe("CR2W files read back as written", () => {
  test("a material instance with its values, imports and header CRC", () => {
    const material = { $type: "CMaterialInstance", baseMaterial: ref("base\\materials\\mesh_decal.mt"), cookingPlatform: "PLATFORM_PC",
      resourceVersion: 4, values: [{ $type: "rRef:ITexture", DiffuseTexture: ref("a\\b\\{material}_diffuse.xbm", "Soft") },
        { $type: "Float", DiffuseAlpha: 0.5 }, { $type: "Color", DiffuseColor: { $type: "Color", Red: 255, Green: 1, Blue: 2, Alpha: 255 } }] };
    const bytes = writeCr2wDocument(doc(material), raw);
    const json = readResourceJson(bytes, noDecompress).Data.RootChunk as Record<string, any>;
    expect(json.baseMaterial.DepotPath.$value).toBe("base\\materials\\mesh_decal.mt");
    expect(json.resourceVersion).toBe(4);
    expect(json.values).toEqual([{ $type: "rRef:ITexture", DiffuseTexture: ref("a\\b\\{material}_diffuse.xbm", "Soft") }, { $type: "Float", DiffuseAlpha: 0.5 },
      { $type: "Color", DiffuseColor: { $type: "Color", Alpha: 255, Blue: 2, Green: 1, Red: 255 } }]);
    // The header CRC covers the 160 header bytes with 0xDEADBEEF in its own place.
    const header = bytes.slice(0, 160);
    new DataView(header.buffer).setUint32(32, 0xdeadbeef, true);
    expect(new DataView(bytes.buffer).getUint32(32, true)).toBe(Bun.hash.crc32(header) >>> 0);
  });

  test("handles become exports depth first, buffers go to the table, derived materials become raw data", () => {
    const mesh = { $type: "CMesh", cookingPlatform: "PLATFORM_PC", resourceVersion: 3,
      localMaterialBuffer: { $type: "meshMeshMaterialBuffer", rawData: null, rawDataHeaders: [],
        materials: [{ $type: "CMaterialInstance", baseMaterial: ref("base\\materials\\mesh_decal.mt"), values: [] }] },
      appearances: [{ HandleId: "10000", Data: { $type: "meshMeshAppearance", name: cname("a"), chunkMaterials: [cname("a@preset")] } },
        { HandleRefId: "10000" }],
      renderResourceBlob: { HandleId: "1", Data: { $type: "rendRenderMeshBlob", renderBuffer: { BufferId: "0", Flags: 4063232, Bytes: Buffer.from([1, 2, 3]).toString("base64") } } } };
    const bytes = writeCr2wDocument(doc(mesh), raw);
    const model = readCr2w(bytes, noDecompress);
    const fields = model.root.fields as Record<string, any>;
    expect(fields.appearances.map((handle: RedHandle) => handle.target?.type)).toEqual(["meshMeshAppearance", "meshMeshAppearance"]);
    expect(fields.appearances[0].target).toBe(fields.appearances[1].target);
    const blob = (fields.renderResourceBlob as RedHandle).target!;
    expect(blob.type).toBe("rendRenderMeshBlob");
    expect([...(blob.fields.renderBuffer as { bytes(): Uint8Array }).bytes()]).toEqual([1, 2, 3]);
    const materials = readResourceJson(bytes, noDecompress).Data.RootChunk as Record<string, any>;
    expect(materials.localMaterialBuffer.materials[0].baseMaterial.DepotPath.$value).toBe("base\\materials\\mesh_decal.mt");
    expect(materials.localMaterialBuffer.rawDataHeaders).toHaveLength(1);
  });

  test("an appearance's components become its compiled package, with path-hash references and CRUIDs", () => {
    const component = { $type: "entMorphTargetSkinnedMeshComponent", name: cname("hx_makeup"), id: "7015115489088265870", autoHideDistance: 50,
      morphResource: ref("x\\plate.morphtarget"), meshAppearance: cname("look"), version: 1,
      parentTransform: { HandleId: "2", Data: { $type: "entHardTransformBinding", bindName: cname("root"), enabled: 1 } },
      skinning: { HandleId: "3", Data: { $type: "entSkinningBinding", bindName: cname("root"), enabled: 1 } } };
    const bytes = writeAppearancePackage([component]);
    const parsed = readPackage(bytes, "appearanceAppearanceDefinition.compiledData");
    expect(parsed.kind).toBe("package");
    if (parsed.kind !== "package") return;
    expect(parsed.cruidDict).toEqual({ "0": "7015115489088265870" });
    const root = parsed.chunks[0]!;
    expect(root.type).toBe("entMorphTargetSkinnedMeshComponent");
    expect((root.fields.parentTransform as RedHandle).target?.type).toBe("entHardTransformBinding");
    expect((root.fields.morphResource as any).DepotPath.$value).toBe(depotPathHash("x\\plate.morphtarget").toString());
    expect(root.fields.isEnabled).toBeUndefined(); // default true: left out
  });

  test("a texture resource from a DDS chain has WolvenKit's mip layout and reversed rows", () => {
    expect(blockLayout(2048, 512, 12, 8).mips.map(m => `${m.slicePitch}/${m.rowPitch}`).join(" "))
      .toBe("524288/4096 131072/2048 32768/1024 8192/512 2048/256 512/128 128/64 32/32 16/16 8/8 8/8 8/8");
    expect(blockLayout(2048, 512, 12, 16).size).toBe(1398160);
    const levels = [new Uint8Array(16).map((_, i) => i), new Uint8Array(4).map((_, i) => 100 + i), new Uint8Array([200, 201]), new Uint8Array([250])];
    const dds = encodeDds(levels, { width: 8, height: 2 }, "r8");
    const texture = readDds(dds);
    expect(texture).toMatchObject({ format: DXGI.R8_UNORM, width: 8, height: 2, levels: 4 });
    expect([...flipLevels(texture).subarray(0, 16)]).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7]);
    expect(importPlan(SCALAR, DXGI.R8_UNORM)).toEqual({ target: DXGI.BC4_UNORM, blockBytes: 8, flags: 0, weight: 1 });
    expect(importPlan(COLOUR, DXGI.R8G8B8A8_UNORM_SRGB)).toEqual({ target: DXGI.BC7_UNORM_SRGB, blockBytes: 16, flags: BCN_GPU, weight: 1 });
    expect(importPlan({ ...SCALAR, GenerateMipMaps: true }, DXGI.R8_UNORM)).toBeNull();
    const NORMAL = Object.fromEntries(TEXTURE_GROUP_SETTINGS)["dds-normal"]!;
    expect(importPlan(NORMAL, DXGI.R8G8B8A8_UNORM)).toEqual({ target: DXGI.BC5_UNORM, blockBytes: 16, flags: 0, weight: 1 });
    expect(importPlan(NORMAL, DXGI.R8G8B8A8_UNORM_SRGB)).toBeNull();
    expect(importPlan({ ...COLOUR, Compression: "TCM_QualityRG" }, DXGI.R8G8B8A8_UNORM_SRGB)).toBeNull();
    const calls: unknown[][] = [];
    const fake: BcnLibrary = { path: "fake", close() {}, compress: (...args) => { calls.push(args); return new Uint8Array(args[8] as number).fill(7); } };
    const bytes = importTexture(dds, SCALAR, fake, raw);
    expect(calls[0]!.slice(2, 8)).toEqual([8, 2, 4, DXGI.BC4_UNORM, 0, 1]);
    const json = readResourceJson(bytes, noDecompress, { buffers: "base64" }).Data.RootChunk as Record<string, any>;
    const header = json.renderTextureResource.renderResourceBlobPC.Data.header;
    expect(json.setup).toMatchObject({ compression: "TCM_QualityR", rawFormat: "TRF_Grayscale", group: "TEXG_Generic_Grayscale", hasMipchain: 1, allowTextureDowngrade: 0 });
    expect(header.textureInfo).toMatchObject({ mipCount: 4, textureDataSize: 40, sliceSize: 40, dataAlignment: 8, type: "TEXTYPE_2D" });
    // Every level takes at least one block: 8x2 is two blocks, then 4x1, 2x1 and 1x1 one each.
    expect(header.mipMapInfo.map((m: any) => m.placement.offset)).toEqual([0, 16, 24, 32]);
    expect(() => importTexture(new Uint8Array(10), SCALAR, fake, raw)).toThrow(NativeWriteRefusal);
  });
});

describe("the archive packer", () => {
  test("CRC-64/XZ and the staging walk (a folder's files, then its folders, breadth first)", () => {
    expect(crc64xz(new TextEncoder().encode("123456789"))).toBe(0x995dc9bbdf1939fan);
    const tree: Record<string, { name: string; folder: boolean; link: boolean }[]> = {
      "": [{ name: "b", folder: true, link: false }, { name: "Z.app", folder: false, link: false }, { name: "a.app", folder: false, link: false }],
      "b\\": [{ name: "c", folder: true, link: false }, { name: "y.mesh", folder: false, link: false }],
      "b\\c\\": [{ name: "x.xbm", folder: false, link: false }],
    };
    expect(walkOrder(folder => tree[folder]!)).toEqual(["a.app", "Z.app", "b\\y.mesh", "b\\c\\x.xbm"]);
    expect(() => walkOrder(() => [{ name: "j", folder: true, link: true }])).toThrow(NativeWriteRefusal);
  });

  test("packs CR2W files in depot-hash order, each extracted file its own bytes again", () => {
    const withBuffer = writeCr2wDocument(doc({ $type: "rendRenderMeshBlob", renderBuffer: { BufferId: "0", Flags: 4063232, Bytes: Buffer.alloc(3000, 5).toString("base64") } }), raw);
    const plain = writeCr2wDocument(doc({ $type: "CMaterialInstance", resourceVersion: 4 }), raw);
    const files = [{ path: "a\\one.mesh", bytes: withBuffer, fileTime: 1n }, { path: "a\\b\\two.mi", bytes: plain, fileTime: 2n }];
    const archive = packArchive(files, neverSmaller);
    const header = parseRdarHeader(archive);
    expect(header.fileSize).toBe(archive.length);
    expect(archive.length % 4096).toBe(0);
    expect(header.indexOffset % 4096).toBe(0);
    const index = new RdarIndex(header, archive.subarray(header.indexOffset, header.indexOffset + header.indexSize), archive.length);
    const hashes = [...index.hashes];
    expect(hashes).toEqual([...hashes].sort((x, y) => x < y ? -1 : 1));
    expect(parseLxrsNames(archive.subarray(172), noDecompress)).toEqual(["a\\one.mesh", "a\\b\\two.mi"]);
    const view = new DataView(archive.buffer);
    expect(view.getBigUint64(header.indexOffset + 8, true)).toBe(crc64xz(archive.subarray(header.indexOffset + 16, header.indexOffset + header.indexSize)));
    for (const file of files) {
      const entry = index.entry(depotPathHash(file.path).toString())!;
      expect(entry.sha1).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
      expect(entry.timestamp).toBe(file.fileTime);
      const segments = index.segments(entry);
      // The body, then the buffers; WolvenKit counts one fewer "inline" buffer than the file has (none without buffers).
      expect(entry.inlineBuffers).toBe(Math.max(0, segments.length - 2));
      const parts = segments.map(s => archive.subarray(s.offset, s.offset + s.storedSize));
      expect(Buffer.compare(Buffer.concat(parts), Buffer.from(file.bytes))).toBe(0);
    }
    // Padding between the data and the index is 0xD9.
    const last = index.segmentAt(index.segmentCount - 1);
    expect(archive.subarray(last.offset + last.storedSize, header.indexOffset).every(byte => byte === 0xd9)).toBe(true);
    // Only file times (and the CRC over them) may differ for the comparison to pass.
    const later = packArchive(files.map(file => ({ ...file, fileTime: file.fileTime + 5n })), neverSmaller);
    expect(archiveEqualExceptTimes(later, archive)).toBe(true);
    const renamed = packArchive([files[0]!, { ...files[1]!, path: "a\\b\\three.mi" }], neverSmaller);
    expect(archiveEqualExceptTimes(renamed, archive)).toBe(false);
    expect(fileTimeOf(0n)).toBe(116444736000000000n);
  });

  test("refuses what it can't pack exactly", () => {
    expect(() => packArchive([], neverSmaller)).toThrow(NativeWriteRefusal);
    expect(() => packArchive([{ path: "x.csv", bytes: new Uint8Array(200), fileTime: 0n }], neverSmaller)).toThrow("not a CR2W");
    const plain = writeCr2wDocument(doc({ $type: "CMaterialInstance", resourceVersion: 4 }), raw);
    expect(() => packArchive([{ path: "a.mi", bytes: plain, fileTime: 0n }, { path: "A.MI", bytes: plain, fileTime: 0n }], neverSmaller)).toThrow("depot hash");
  });
});

describe("the Build's tools write natively and send refusals to WolvenKit", () => {
  const folders: string[] = [];
  const temp = () => { const dir = mkdtempSync(join(tmpdir(), "xfs-native-tools-")); folders.push(dir); return dir; };
  const fakeWolvenKit = (calls: string[]): ResourceTools => ({
    identity: "wolvenkit:9.0.1:0123456789abcdef",
    async importTextures(input, output) { calls.push(`import ${readdirSync(input).join(",")}`); for (const name of readdirSync(input)) writeFileSync(join(output, name.replace(/\.dds$/, ".xbm")), "wk"); return { exitCode: 0, log: "wk import" }; },
    async serialize() { calls.push("serialize"); return { exitCode: 0, log: "" }; },
    async deserialize(input, output) {
      for (const item of [input].flat()) for (const [folder, name] of statSync(item).isFile() ? [[join(item, ".."), basename(item)]] : readdirSync(item).map(name => [item, name])) {
        calls.push(`deserialize ${name}`); writeFileSync(join(output, name!.replace(/\.json$/, "")), "wk"); void folder;
      }
      return { exitCode: 0, log: "wk deserialize" };
    },
    async pack(_input, output) { calls.push("pack"); writeFileSync(join(output, "archive.archive"), "wk"); return { exitCode: 0, log: "wk pack" }; },
  });
  const oodle = { path: "fake", identity: "fake", sha256: "0", trustedBy: "test", decompress: noDecompress, close() {},
    compress: (input: Uint8Array) => neverSmaller(input) } as unknown as import("../src/native/oodle").OodleLibrary;
  const bcn: BcnLibrary = { path: "fake", close() {}, compress: (...args) => new Uint8Array(args[8] as number) };

  test("each refused input, and only those, goes to WolvenKit; the report says which writer made what", async () => {
    const root = temp(), json = join(root, "json"), out = join(root, "resources"), dds = join(root, "dds"), xbm = join(root, "xbm");
    for (const dir of [json, out, dds, xbm]) mkdirSync(dir);
    writeFileSync(join(json, "good.inkcharcustomization.json"), JSON.stringify(doc({ $type: "gameuiCharacterCustomizationInfoResource", cookingPlatform: "PLATFORM_PC" })));
    writeFileSync(join(json, "odd.mi.json"), JSON.stringify(doc({ $type: "NotAClass" })));
    writeFileSync(join(dds, "a_roughness.dds"), encodeDds([new Uint8Array(16), new Uint8Array(4), new Uint8Array(1)], { width: 4, height: 4 }, "r8"));
    const calls: string[] = [];
    const tools = createNativeResourceTools(fakeWolvenKit(calls), { oodle, bcn }, nodeWriterHost);
    await tools.deserialize([json], out, { oracle: EYE_MAKEUP_WRITER_ORACLE });
    await tools.importTextures(dds, xbm, { ...SCALAR, GenerateMipMaps: true } as TextureImportSettings);
    expect(calls).toEqual(["deserialize odd.mi.json", "import a_roughness.dds"]);
    expect(readFileSync(join(out, "good.inkcharcustomization")).subarray(0, 4).toString()).toBe("CR2W");
    expect(readFileSync(join(out, "odd.mi"), "utf8")).toBe("wk");
    const staging = join(root, "archive"), packed = join(root, "packed");
    mkdirSync(join(staging, "x"), { recursive: true }); mkdirSync(packed);
    writeFileSync(join(staging, "x", "good.inkcharcustomization"), readFileSync(join(out, "good.inkcharcustomization")));
    await tools.pack(staging, packed);
    expect(readFileSync(join(packed, "archive.archive")).subarray(0, 4).toString()).toBe("RDAR");
    const report = tools.writers!();
    expect(report.native).toEqual(["good.inkcharcustomization", "archive"]);
    expect(report.wolvenkit.map(item => item.file)).toEqual(["odd.mi", "a_roughness.xbm"]);
    expect(report.wolvenkit[0]!.reason).toContain("NotAClass");
    expect(tools.identity).toBe("wolvenkit:9.0.1:0123456789abcdef");
    for (const dir of folders) rmSync(dir, { recursive: true, force: true });
  });

  test("without the game's compressor everything is WolvenKit's, and says why", async () => {
    const root = temp(), json = join(root, "json"), out = join(root, "out"), staging = join(root, "archive"), packed = join(root, "packed");
    for (const dir of [json, out, staging, packed]) mkdirSync(dir);
    writeFileSync(join(json, "good.app.json"), JSON.stringify(doc({ $type: "appearanceAppearanceResource" })));
    const calls: string[] = [];
    const tools = createNativeResourceTools(fakeWolvenKit(calls), { oodle: { unavailable: "no game" }, bcn: { unavailable: "not built" } }, nodeWriterHost);
    await tools.deserialize(json, out, { oracle: EYE_MAKEUP_WRITER_ORACLE });
    await tools.pack(staging, packed);
    expect(calls).toEqual(["deserialize good.app.json", "pack"]);
    expect(tools.writers!().wolvenkit.every(item => item.reason.includes("no game"))).toBe(true);
    const libraries = loadNativeWriterLibraries(root, [join(root, "missing.dll")], { oodle: () => { throw Error("no Oodle here"); }, bcn: loadBcnLibrary, isFile: nodeWriterHost.isFile });
    expect(libraries).toEqual({ oodle: { unavailable: "no Oodle here" }, bcn: { unavailable: "XF Studio's texture compressor is not installed." } });
    for (const dir of folders) rmSync(dir, { recursive: true, force: true });
  });

  test("only documents an oracle proves are written natively; the rest, and single files, are WolvenKit's with the reason (NATIVE-72)", async () => {
    const root = temp(), json = join(root, "json"), out = join(root, "out");
    for (const dir of [json, out]) mkdirSync(dir);
    const app = { $type: "appearanceAppearanceResource", cookingPlatform: "PLATFORM_PC" };
    writeFileSync(join(json, "face_rig.app.json"), JSON.stringify(doc(app)));
    writeFileSync(join(json, "material.mi.json"), JSON.stringify(doc({ $type: "CMaterialInstance", resourceVersion: 4 })));
    // The expressions exporter names no oracle and converts file by file: WolvenKit converts that file as given, in one launch.
    const calls: string[] = [], seen: unknown[] = [];
    const base = fakeWolvenKit(calls);
    const tools = createNativeResourceTools({ ...base, deserialize: (input, output, options) => { seen.push([input, options]); return base.deserialize(input, output, options); } },
      { oodle, bcn }, nodeWriterHost);
    await tools.deserialize(join(json, "face_rig.app.json"), out);
    expect(calls).toEqual(["deserialize face_rig.app.json"]);
    expect(seen).toEqual([[join(json, "face_rig.app.json"), undefined]]);
    expect(tools.writers!()).toEqual({ native: [], wolvenkit: [{ file: "face_rig.app", reason: "No oracle proves the native writer on this exporter's files yet." }] });
    // With the eye-makeup oracle, a root it doesn't cover (a material written as a file of its own) is WolvenKit's; the .app is native.
    calls.length = 0;
    await tools.deserialize(json, out, { oracle: EYE_MAKEUP_WRITER_ORACLE });
    expect(calls).toEqual(["deserialize material.mi.json"]);
    expect(readFileSync(join(out, "face_rig.app")).subarray(0, 4).toString()).toBe("CR2W");
    expect(tools.writers!().wolvenkit.at(-1)).toEqual({ file: "material.mi", reason: "The eye-makeup oracle doesn't cover CMaterialInstance." });
    // An oracle nobody captured proves nothing.
    expect(oracleRefusal("CMesh", { oracle: "expressions" })).toBe("The native writer has no oracle named expressions.");
    expect(oracleRefusal("CMesh", { oracle: EYE_MAKEUP_WRITER_ORACLE })).toBeNull();
    expect(Object.keys(NATIVE_WRITER_ORACLES)).toEqual([EYE_MAKEUP_WRITER_ORACLE]);
    // The expressions exporter converts with no oracle.
    const expressions = readFileSync(resolve(import.meta.dir, "..", "src", "features", "expressions", "export", "index.ts"), "utf8");
    expect(expressions).toContain("context.tools.deserialize(source, dirname(target))");
    for (const dir of folders) rmSync(dir, { recursive: true, force: true });
  });

  test("a WolvenKit other than 9.0.1, or JSON of another version, is never written natively (PIPE-135)", async () => {
    const root = temp(), json = join(root, "json"), out = join(root, "out"), dds = join(root, "dds"), xbm = join(root, "xbm");
    const staging = join(root, "archive"), packed = join(root, "packed");
    for (const dir of [json, out, dds, xbm, staging, packed]) mkdirSync(dir);
    writeFileSync(join(json, "good.app.json"), JSON.stringify(doc({ $type: "appearanceAppearanceResource" })));
    writeFileSync(join(dds, "a_roughness.dds"), encodeDds([new Uint8Array(16), new Uint8Array(4), new Uint8Array(1)], { width: 4, height: 4 }, "r8"));
    const calls: string[] = [];
    const tools = createNativeResourceTools({ ...fakeWolvenKit(calls), identity: "wolvenkit:8.17.4:0123456789abcdef" }, { oodle, bcn }, nodeWriterHost);
    await tools.deserialize(json, out, { oracle: EYE_MAKEUP_WRITER_ORACLE });
    await tools.importTextures(dds, xbm, { ...SCALAR, GenerateMipMaps: true } as TextureImportSettings);
    await tools.pack(staging, packed);
    expect(calls).toEqual(["deserialize good.app.json", "import a_roughness.dds", "pack"]);
    const report = tools.writers!();
    expect(report.native).toEqual([]);
    expect(new Set(report.wolvenkit.map(item => item.reason))).toEqual(new Set(["The native writer matches WolvenKit 9.0.1; this Build's WolvenKit is 8.17.4."]));
    expect(wolvenKitRefusal(undefined)).toContain("of an unknown version");
    expect(wolvenKitRefusal("wolvenkit:unknown:0123")).toContain("of an unknown version");
    const older = doc({ $type: "appearanceAppearanceResource" });
    older.Header.WKitJsonVersion = "0.0.8";
    expect(() => writeCr2wDocument(older, raw)).toThrow("WolvenKit JSON version \"0.0.8\" is not written");
    for (const dir of folders) rmSync(dir, { recursive: true, force: true });
  });

  test("the tools stop between files when the Build is cancelled, and start no WolvenKit (NATIVE-74)", async () => {
    const root = temp(), json = join(root, "json"), out = join(root, "out"), staging = join(root, "archive"), packed = join(root, "packed");
    for (const dir of [json, out, staging, packed]) mkdirSync(dir);
    writeFileSync(join(json, "a.app.json"), JSON.stringify(doc({ $type: "appearanceAppearanceResource" })));
    writeFileSync(join(json, "b.mi.json"), JSON.stringify(doc({ $type: "NotAClass" })));
    const calls: string[] = [], controller = new AbortController();
    let reads = 0;
    const host = { ...nodeWriterHost, read: (path: string) => { if (++reads === 1) controller.abort(); return nodeWriterHost.read(path); } };
    const tools = createNativeResourceTools(fakeWolvenKit(calls), { oodle, bcn }, host, { signal: controller.signal });
    await expect(tools.deserialize(json, out, { oracle: EYE_MAKEUP_WRITER_ORACLE })).rejects.toMatchObject({ code: "package_build_cancelled" });
    await expect(tools.pack(staging, packed)).rejects.toMatchObject({ code: "package_build_cancelled" });
    expect(calls).toEqual([]);
    expect(reads).toBe(1);
    for (const dir of folders) rmSync(dir, { recursive: true, force: true });
  });

  test("a staging tree with a link is packed by WolvenKit instead", async () => {
    if (process.platform !== "win32") return;
    const root = temp(), staging = join(root, "archive"), packed = join(root, "packed"), target = join(root, "target");
    for (const dir of [staging, packed, target]) mkdirSync(dir);
    try { symlinkSync(target, join(staging, "linked"), "junction"); } catch { return; }
    const calls: string[] = [];
    const tools = createNativeResourceTools(fakeWolvenKit(calls), { oodle, bcn }, nodeWriterHost);
    await tools.pack(staging, packed);
    expect(calls).toEqual(["pack"]);
    expect(tools.writers!().wolvenkit[0]!.reason).toContain("link");
    rmSync(join(staging, "linked"), { recursive: false, force: true });
    for (const dir of folders) rmSync(dir, { recursive: true, force: true });
  });
});

// The oracles: WolvenKit 9.0.1's conversions of real Builds (tools/native-writer-oracle.ts capture <kept Build> <name>), each compared byte
// for byte: every resource, and the archive but for the file times its index records.
const ORACLES = resolve(process.env.XFS_NATIVE_WRITER_ORACLE ?? resolve(import.meta.dir, "..", "data", "native-writer-oracle"));
const GAME = process.env.XFS_RESOLVER_GAME_ROOT;
const BCN = process.env.XFS_BCN_LIBRARY ?? resolve(import.meta.dir, "..", "data", "tools", "xfs-bcn", "xfs_bcn.dll");
const oracleNames = existsSync(ORACLES) ? readdirSync(ORACLES).filter(name => existsSync(join(ORACLES, name, "oracle.json"))).sort() : [];
const oracleReady = oracleNames.length > 0 && !!GAME && existsSync(join(GAME ?? "", "bin", "x64", "oo2ext_7_win64.dll")) && existsSync(BCN);
oracleDescribe(oracleReady, "the native writer's oracles need a captured WolvenKit Build (bun tools/native-writer-oracle.ts capture), " +
  "XFS_RESOLVER_GAME_ROOT (the game's Oodle) and XF Studio's texture compressor (bun tools/build-native-bcn.ts).")("the native writer against WolvenKit", () => {
  const files = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).filter(path => statSync(join(dir, path)).isFile());
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

  for (const name of oracleNames) test(`${name}: every resource is WolvenKit's, byte for byte, and so is the archive but for its file times`, () => {
    const oracle = join(ORACLES, name);
    const game = loadGameOodle(GAME!), textures = loadBcnLibrary(BCN);
    try {
      const store = (input: Uint8Array) => karkSegment(input, LEVEL_OPTIMAL2, game.compress!);
      const wolvenkit = new Map(files(join(oracle, "wolvenkit")).map(path => [path.split(/[\\/]/).pop()!, join(oracle, "wolvenkit", path)]));
      const results: Record<string, boolean> = {};
      for (const file of readdirSync(join(oracle, "json"))) {
        const resource = file.replace(/\.json$/, "");
        results[resource] = sha(writeCr2wDocument(JSON.parse(readFileSync(join(oracle, "json", file), "utf8")), store)) === sha(readFileSync(wolvenkit.get(resource)!));
      }
      const settings = new Map(TEXTURE_GROUP_SETTINGS);
      for (const group of existsSync(join(oracle, "dds")) ? readdirSync(join(oracle, "dds")) : [])
        for (const file of readdirSync(join(oracle, "dds", group))) {
          const resource = file.replace(/\.dds$/, ".xbm");
          results[resource] = sha(importTexture(new Uint8Array(readFileSync(join(oracle, "dds", group, file))), settings.get(group)!, textures, store)) ===
            sha(readFileSync(wolvenkit.get(resource)!));
        }
      expect(Object.keys(results).length).toBe(wolvenkit.size);
      expect(Object.entries(results).filter(([, same]) => !same).map(([resource]) => resource)).toEqual([]);
      const staging = join(oracle, "wolvenkit");
      const paths = walkOrder(relative => readdirSync(join(staging, ...relative.split("\\").filter(Boolean)), { withFileTypes: true })
        .map(entry => ({ name: entry.name, folder: entry.isDirectory(), link: entry.isSymbolicLink() })));
      const archive = packArchive(paths.map(path => ({ path, bytes: new Uint8Array(readFileSync(join(staging, ...path.split("\\")))), fileTime: 0n })), game.compress!);
      expect(archiveEqualExceptTimes(archive, new Uint8Array(readFileSync(join(oracle, "wolvenkit.archive"))))).toBe(true);
    } finally { game.close(); textures.close(); }
  }, 180_000);
});
