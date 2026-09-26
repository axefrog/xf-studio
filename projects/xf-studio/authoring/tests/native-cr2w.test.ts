import { expect, test } from "bun:test";
import { buildMountPlan, DepotIndex } from "../src/archive-precedence";
import { readArchiveXlConfig } from "../src/archivexl-config";
import { depotHash, refFromHash } from "../src/depot-path";
import { float32Text, float32Value } from "../src/native/json-numbers";
import { NativeUnsupportedError } from "../src/native/red-model";
import { readResourceJson } from "../src/native/resource-document";
import { cr2wRoot, materialParams } from "../src/red-json";
import { ResourceGraph } from "../src/resource-graph";
import { fakeDecompress, kark } from "./fixtures/native-archive";
import { buildPackage, Bytes, Cr2wBuilder, materialValues, prop, v } from "./fixtures/native-cr2w";

const json = (bytes: Uint8Array) => readResourceJson(bytes, fakeDecompress) as { Header: Record<string, unknown>; Data: { RootChunk: Record<string, any> } };

/** A material instance: a base material reference, one set flag and a parameter list with a scalar, a texture and a colour. */
function materialInstance(): Uint8Array {
  const file = new Cr2wBuilder();
  const base = file.import("base\\materials\\skin.mt");
  const texture = file.import("Base/Textures//Albedo.xbm", 4);
  file.export("CMaterialInstance", [prop("baseMaterial", "rRef:IMaterial", v.ref(base)), prop("enableMask", "Bool", v.bool(true))],
    materialValues([
      { name: "Roughness", type: "Float", write: v.f32(0.15) },
      { name: "Albedo", type: "rRef:ITexture", write: v.ref(texture) },
      { name: "Tint", type: "Color", write: v.struct([prop("Red", "Uint8", v.u8(255)), prop("Alpha", "Uint8", v.u8(128))]) },
    ]));
  return file.build();
}

test("a material instance reads as the resolver's JSON: references, parameter list, defaults and key order", () => {
  const document = json(materialInstance());
  const root = document.Data.RootChunk;
  expect(Object.keys(root)[0]).toBe("$type");
  expect(root.$type).toBe("CMaterialInstance");
  expect(root.baseMaterial).toEqual({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: "base\\materials\\skin.mt" }, Flags: "Default" });
  expect(root.enableMask).toBe(1);
  // Properties the file left out are written with their defaults.
  expect(root.audioTag).toEqual({ $type: "CName", $storage: "string", $value: "None" });
  expect(root.cookingPlatform).toBe("PLATFORM_None");
  expect(root.metadata).toBeNull();
  // English collation, not ordinal: `audioTag` < `baseMaterial` < `cookingPlatform` < `enableMask` < `metadata` < ...
  expect(Object.keys(root).slice(1)).toEqual([...Object.keys(root).slice(1)].sort(new Intl.Collator("en").compare));
  const params = materialParams(root.values);
  expect(params[0]).toEqual(["Roughness", { kind: "scalar", type: "Float", value: 0.150000006 }]);
  // Import paths are shown normalised: trimmed, lower-case, backslashes, no repeated separators; flags by name.
  expect(root.values[1].Albedo).toEqual({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: "base\\textures\\albedo.xbm" }, Flags: "Soft" });
  expect(root.values[2]).toEqual({ $type: "Color", Tint: { $type: "Color", Alpha: 128, Blue: 0, Green: 0, Red: 255 } });
  expect(document.Header).toMatchObject({ WKitJsonVersion: "0.0.9", DataType: "CR2W" });
});

/** A mesh with two appearances, a render blob with two chunks and a compressed local material buffer holding one material. */
function mesh(): Uint8Array {
  const file = new Cr2wBuilder();
  const localMaterial = materialInstance();
  const buffer = file.buffer(kark(localMaterial), localMaterial.length);
  const renderBuffer = file.buffer(new Uint8Array([1, 2, 3, 4, 5]));
  const chunk = (lodMask: number, ...flags: string[]) => v.struct([prop("lodMask", "Uint8", v.u8(lodMask)), ...(flags.length ? [prop("renderMask", "EMeshChunkFlags", v.bitfield(...flags))] : [])]);
  file.export("CMesh", [
    prop("appearances", "array:handle:meshMeshAppearance", v.array([v.handle(1), v.handle(2)])),
    prop("materialEntries", "array:CMeshMaterialEntry", v.array([v.struct([prop("name", "CName", v.cname("@context")), prop("isLocalInstance", "Bool", v.bool(true))])])),
    prop("localMaterialBuffer", "meshMeshMaterialBuffer", v.struct([prop("rawData", "DataBuffer", v.buffer(buffer)),
      prop("rawDataHeaders", "array:meshLocalMaterialHeader", v.array([v.struct([prop("size", "Uint32", v.u32(localMaterial.length))])]))])),
    prop("renderResourceBlob", "handle:IRenderResourceBlob", v.handle(3)),
  ]);
  file.export("meshMeshAppearance", [prop("name", "CName", v.cname("red")), prop("chunkMaterials", "array:CName", v.array([v.cname("@context"), v.cname("hair")]))]);
  file.export("meshMeshAppearance", [prop("name", "CName", v.cname("blue")), prop("tags", "array:CName", v.array([v.cname("long")]))]);
  file.export("rendRenderMeshBlob", [
    prop("header", "rendRenderMeshBlobHeader", v.struct([prop("renderChunkInfos", "array:rendChunk", v.array([chunk(1, "MCF_RenderInShadows", "MCF_RenderInScene"), chunk(0)]))])),
    prop("renderBuffer", "DataBuffer", v.buffer(renderBuffer)),
  ]);
  return file.build();
}

test("a mesh reads as the resolver's JSON and the resource graph builds the same model from it", async () => {
  const bytes = mesh();
  const document = json(bytes);
  const root = document.Data.RootChunk;
  expect(root.appearances.map((a: any) => a.HandleId)).toEqual(["0", "1"]);
  expect(root.appearances[0].Data.chunkMaterials.map((c: any) => c.$value)).toEqual(["@context", "hair"]);
  // A bitfield is its names in bit order; buffers are numbered in write order and trimmed to their base64 length.
  const blob = root.renderResourceBlob.Data;
  expect(root.renderResourceBlob.HandleId).toBe("2");
  expect(blob.header.renderChunkInfos[0].renderMask).toBe("MCF_RenderInScene, MCF_RenderInShadows");
  // An omitted bitfield is written as "0", as the reference JSON does for `rendChunk.renderMask` (its default there is no flags).
  expect(blob.header.renderChunkInfos[1].renderMask).toBe("0");
  expect(root.localMaterialBuffer.rawData).toMatchObject({ BufferId: "0", Type: "CR2WList" });
  expect(blob.renderBuffer).toEqual({ BufferId: "1", Flags: 0, Bytes: { $trimmedBase64Length: 8 } });
  // The local material list's root objects are also written as `materials`.
  expect(root.localMaterialBuffer.materials).toHaveLength(1);
  expect(root.localMaterialBuffer.materials[0].$type).toBe("CMaterialInstance");

  const hash = depotHash("test\\x.mesh");
  const plan = buildMountPlan([{ id: "x.archive", virtualPath: "archive/pc/content/x.archive", provider: "game", providerName: "Installed game", active: true, priority: null }], null);
  const graph = new ResourceGraph(new DepotIndex(plan, new Map([["x.archive", BigUint64Array.from([BigInt(hash)])]])), readArchiveXlConfig([]),
    { fetch: async () => ({ document, extractedSha256: null }) }, false);
  const model = (await graph.mesh(refFromHash(hash)))!;
  expect(model.appearances.map(a => [a.name, a.chunkMaterials, a.expansionTag])).toEqual([["red", ["@context", "hair"], null], ["blue", [], "long"]]);
  expect(model.renderChunks).toBe(2);
  expect(model.renderChunkLods).toEqual([1, 0]);
  expect(model.renderChunkScene).toEqual([true, false]);
  expect(model.entries).toEqual([{ name: "@context", local: true, index: 0 }]);
  expect(model.localMaterials).toHaveLength(1);
});

test("an entity template's package decodes: roots, CRUIDs, handles, references and the derived entity and components", () => {
  const names = ["entEntity", "entSkinnedMeshComponent", "entHardTransformBinding", "name", "CName", "mesh", "raRef:CMesh", "parentTransform",
    "handle:entITransformBinding", "bindName", "root", "hair", "chunkMask", "Uint64"];
  const n = (value: string) => names.indexOf(value);
  const compiled = buildPackage({ names, refs: [{ path: "Base\\Hair.mesh", sync: false }], cruids: [0n, 42n], rootIndex: 0, objects: [
    { type: "entEntity", fields: [] },
    { type: "entSkinnedMeshComponent", fields: [
      { name: "name", type: "CName", write: w => { w.u16(n("hair")); } },
      { name: "mesh", type: "raRef:CMesh", write: w => { w.i16(0); } },
      { name: "chunkMask", type: "Uint64", write: w => { w.u64(5n); } },
      { name: "parentTransform", type: "handle:entITransformBinding", write: w => { w.i32(2); } }] },
    { type: "entHardTransformBinding", fields: [{ name: "bindName", type: "CName", write: w => { w.u16(n("root")); } }] },
  ] });
  const file = new Cr2wBuilder();
  const buffer = file.buffer(compiled);
  file.export("entEntityTemplate", [prop("compiledData", "DataBuffer", v.buffer(buffer))]);
  const root = json(file.build()).Data.RootChunk;
  const data = root.compiledData.Data;
  expect(root.compiledData).toMatchObject({ BufferId: "0", Type: "RedPackage" });
  expect(data).toMatchObject({ Version: 4, Sections: 7, CruidIndex: 0, CruidDict: { "0": "0", "1": "42" } });
  // The binding is referenced by a handle, so it is not a root: it is written where the handle first meets it.
  expect(data.Chunks.map((c: any) => c.$type)).toEqual(["entEntity", "entSkinnedMeshComponent"]);
  const component = data.Chunks[1];
  expect(component.mesh).toEqual({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: "base\\hair.mesh" }, Flags: "Default" });
  expect(component.chunkMask).toBe("5");
  expect(component.parentTransform).toMatchObject({ HandleId: "0", Data: { $type: "entHardTransformBinding", bindName: { $value: "root" } } });
  // `components` repeats the component (its handle now a reference); `entity` inlines the entity again with a new id.
  expect(root.components.map((c: any) => c.$type)).toEqual(["entSkinnedMeshComponent"]);
  expect(root.components[0].parentTransform).toEqual({ HandleRefId: "0" });
  expect(root.entity).toMatchObject({ HandleId: "1", Data: { $type: "entEntity" } });
});

test("strict decoding: a record that does not use its size, unknown trailing data and unsupported values are refused", () => {
  const short = new Cr2wBuilder();
  short.export("CMaterialInstance", [{ name: "enableMask", type: "Bool", write: w => { w.u8(1).u8(0); } }]);
  expect(() => json(short.build())).toThrow("read 5 of 6 bytes");
  const trailing = new Cr2wBuilder();
  trailing.export("CHairProfile", [], w => { w.u32(7); });
  expect(() => json(trailing.build())).toThrow(NativeUnsupportedError);
  const curve = new Cr2wBuilder();
  curve.export("CGradient", [{ name: "curve", type: "curveData:Float", write: w => { w.u32(0).u8(0).u8(0); } }]);
  expect(() => json(curve.build())).toThrow(NativeUnsupportedError);
  expect(() => json(new Bytes().u32(1).done())).toThrow();
});

test("floats read as the reference JSON prints them: 9 significant digits, ties to even", () => {
  const f = (value: number) => Math.fround(value);
  expect(float32Text(f(0.15))).toBe("0.150000006");
  expect(float32Text(2 ** -13)).toBe("0.000122070312");
  expect(float32Text(f(7.60556361e-7))).toBe("7.60556361E-07");
  expect(float32Text(f(1e9))).toBe("1E+09");
  expect(float32Text(f(0.0001))).toBe("9.99999975E-05");
  expect(float32Text(-0)).toBe("-0");
  expect(float32Text(f(123456789))).toBe("123456792");
  for (const value of [0.15, 2 ** -13, 7.60556361e-7, 1, -5, 0.0152, 3.4028234663852886e38, 1e-40]) expect(float32Value(f(value))).toBe(Number(float32Text(f(value))));
  expect(float32Value(Infinity)).toBe("+inf");
  expect(float32Value(NaN)).toBeNull();
  expect(cr2wRoot(json(materialInstance())).root.$type).toBe("CMaterialInstance");
});
