import { expect, test } from "bun:test";
import { derivePlateDocuments } from "../src/eye-plate-cut";
import { decodeDec4Normal, liftPlate, MAX_PLATE_LIFT_MM, PLATE_LIFT_MM } from "../src/plate-lift";
import { parseCollection, planCollection } from "../src/preset-collection";
import { preparePackageCollection } from "../src/package-filter";
import { preflightPackageCollection } from "../src/package-preflight";
import { HandleCounter, HIDDEN_CHUNK_ENTRY, rewritePlateMesh } from "../src/package-resources";
import { SURFACE_OVERRIDE_RANGES } from "../src/export-diagnostics";
import { VERIFIER_PLATE_LIFT_MM } from "../src/mod-verifier/plate-geometry";
import { VERIFIER_SURFACE_RANGES } from "../src/mod-verifier/resource-checks";
import { initialRecipe } from "../src/recipe";
import { fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe } from "./eye-plate-fixture";

const plate = () => derivePlateDocuments(fixtureHeadMesh(), fixtureHeadMorph(), fixtureRecipe(), "xfs\\eye_plate\\xfs_eye_plate.mesh");
const blobOf = (mesh: any) => mesh.Data.RootChunk.renderResourceBlob.Data;
const raw = (blob: any) => Buffer.from(blob.renderBuffer.Bytes, "base64");

function positions(blob: any, chunk = 0) {
  const h = blob.header, c = h.renderChunkInfos[chunk], data = raw(blob), stride = c.chunkVertices.vertexLayout.slotStrides.Elements[0];
  const scale = ["X", "Y", "Z"].map(a => h.quantizationScale[a]), offset = ["X", "Y", "Z"].map(a => h.quantizationOffset[a]);
  return Array.from({ length: c.numVertices }, (_, v) => [0, 1, 2].map(k =>
    Math.max(-1, data.readInt16LE(c.chunkVertices.byteOffsets.Elements[0] + v * stride + k * 2) / 32767) * scale[k] + offset[k]));
}
function normals(blob: any) {
  const c = blob.header.renderChunkInfos[0], data = raw(blob);
  return Array.from({ length: c.numVertices }, (_, v) => decodeDec4Normal(data.readUInt32LE(c.chunkVertices.byteOffsets.Elements[2] + v * 8)));
}

test("a zero lift reproduces the plate byte for byte, and the production lift is the vanilla decal offset", () => {
  const { mesh, morph } = plate();
  const zero = liftPlate(mesh, morph, [0]);
  expect(zero.mesh).toEqual(mesh);
  expect(zero.morph).toEqual(morph);
  expect(zero.report).toMatchObject({ chunks: 1, headQuantizationRetained: true, requantizedTargets: 0, maxPositionErrorMm: 0 });
  // Restated in the independent verifier on purpose; both must say 0.4 mm.
  expect(PLATE_LIFT_MM).toBe(0.4);
  expect(VERIFIER_PLATE_LIFT_MM).toBe(PLATE_LIFT_MM);
  expect(VERIFIER_SURFACE_RANGES).toEqual(SURFACE_OVERRIDE_RANGES as unknown as typeof VERIFIER_SURFACE_RANGES);
  expect(() => liftPlate(mesh, morph, [])).toThrow("between 0 and");
  expect(() => liftPlate(mesh, morph, [MAX_PLATE_LIFT_MM + 0.1])).toThrow("between 0 and");
});

test("the lift moves positions along the stored normals and keeps every other byte, in mesh and morph base alike", () => {
  const { mesh, morph } = plate(), lifted = liftPlate(mesh, morph, [0.4]);
  const before = blobOf(mesh), after = blobOf(lifted.mesh), base = lifted.morph.Data.RootChunk.blob.Data.baseBlob.Data;
  expect(raw(after).equals(raw(base))).toBe(true);
  const p0 = positions(before), p1 = positions(after), n = normals(before);
  const scale = ["X", "Y", "Z"].map(a => after.header.quantizationScale[a]);
  p1.forEach((p, v) => p.forEach((value, k) => expect(Math.abs(value - (p0[v][k] + 0.0004 * n[v][k]))).toBeLessThanOrEqual(scale[k] / 32767 / 2 + 1e-12)));
  // Everything after each vertex's first six bytes of stream 0 (skin, extra), and every other stream, is unchanged.
  const c = before.header.renderChunkInfos[0], stride = c.chunkVertices.vertexLayout.slotStrides.Elements[0], a = raw(before), b = raw(after);
  for (let v = 0; v < c.numVertices; v++) expect(b.subarray(v * stride + 6, (v + 1) * stride).equals(a.subarray(v * stride + 6, (v + 1) * stride))).toBe(true);
  expect(b.subarray(c.chunkVertices.byteOffsets.Elements[1]).equals(a.subarray(c.chunkVertices.byteOffsets.Elements[1]))).toBe(true);
  // Morph rows keep their mapping and normal/tangent words.
  const inDiffs = Buffer.from(morph.Data.RootChunk.blob.Data.diffsBuffer.Bytes, "base64");
  const outDiffs = Buffer.from(lifted.morph.Data.RootChunk.blob.Data.diffsBuffer.Bytes, "base64");
  expect(outDiffs.length).toBe(inDiffs.length);
  for (let r = 0; r < inDiffs.length / 12; r++) expect(outDiffs.subarray(r * 12 + 4, r * 12 + 12).equals(inDiffs.subarray(r * 12 + 4, r * 12 + 12))).toBe(true);
  expect(lifted.morph.Data.RootChunk.blob.Data.mappingBuffer.Bytes).toBe(morph.Data.RootChunk.blob.Data.mappingBuffer.Bytes);
});

test("a lift that would leave the head's position range is refused instead of re-quantizing the plate", () => {
  const { mesh, morph } = plate(), source = blobOf(mesh), base = morph.Data.RootChunk.blob.Data.baseBlob.Data;
  // Put vertex 0 at the edge of the range along its normal's largest axis, in mesh and morph base alike.
  const n = normals(source)[0]!, axis = [0, 1, 2].reduce((best, a) => Math.abs(n[a]!) > Math.abs(n[best]!) ? a : best, 0);
  const stride = source.header.renderChunkInfos[0].chunkVertices.vertexLayout.slotStrides.Elements[0];
  for (const blob of [source, base]) {
    const data = raw(blob); data.writeInt16LE(Math.sign(n[axis]!) * 32767, 0 * stride + axis * 2);
    blob.renderBuffer.Bytes = data.toString("base64");
  }
  expect(() => liftPlate(mesh, morph, [0.4])).toThrow("would leave the head's position range");
  expect(liftPlate(mesh, morph, [0]).report.headQuantizationRetained).toBe(true);
});

test("several lifts become one chunk each, with vanilla multi-chunk index offsets and per-chunk morph runs", () => {
  const { mesh, morph } = plate(), lifted = liftPlate(mesh, morph, [0, 0.2, 0.4]);
  const header = blobOf(lifted.mesh).header, source = blobOf(mesh).header.renderChunkInfos[0];
  expect(header.renderChunkInfos).toHaveLength(3);
  expect(header.renderChunkInfos.map((c: any) => c.chunkIndices.teOffset)).toEqual([0, 1, 2].map(k => k * source.numIndices * 2));
  expect(header.indexBufferSize).toBe(3 * source.numIndices * 2);
  expect(header.topology ?? [undefined]).toHaveLength(header.topology ? 3 : 1);
  const morphHeader = lifted.morph.Data.RootChunk.blob.Data.header, inHeader = morph.Data.RootChunk.blob.Data.header;
  morphHeader.numVertexDiffsInEachChunk.forEach((counts: number[], t: number) => expect(counts).toEqual([0, 1, 2].map(() => inHeader.numVertexDiffsInEachChunk[t][0])));
  expect(morphHeader.numDiffs).toBe(3 * inHeader.numDiffs);
  // Chunk 0 is the unlifted control.
  expect(positions(blobOf(lifted.mesh), 0)).toEqual(positions(blobOf(mesh), 0));
});

const uuid = (n: number) => `11ea932b-7ce9-4d40-a284-${String(n).padStart(12, "0")}`;
const collection = (diagnostics?: unknown) => ({ schema: "xfas/collection-1", id: uuid(99), name: "Depth",
  presets: [1, 2, 3].map(i => ({ id: uuid(i), name: `Look ${i}`, revision: 1, recipe: initialRecipe() })), ...(diagnostics ? { diagnostics } : {}) });

test("diagnostic lifts and surfaces plan one chunk per lift and one flat entry per override, and only exported files carry them", () => {
  const plain = planCollection(collection());
  expect(plain.plate).toEqual({ liftsMm: [PLATE_LIFT_MM] });
  expect(plain.presets.map(p => p.plateChunk)).toEqual([0, 0, 0]);
  const diagnostics = { schema: "xfs/export-diagnostics-1", presets: {
    [uuid(1)]: { plateLiftMm: 0 }, [uuid(2)]: { plateLiftMm: 0.2, surface: { RoughnessMetalnessAlpha: 0 } }, [uuid(77)]: { plateLiftMm: 0.1 } } };
  const plan = planCollection(collection(diagnostics));
  expect(plan.plate.liftsMm).toEqual([0, 0.2, 0.4]);
  expect(plan.presets.map(p => p.plateChunk)).toEqual([0, 1, 2]);
  expect(plan.presets[1].material).toMatch(/^@flat_[0-9a-f]{8}$/);
  expect(plan.presets[0].material).toBe("@preset");
  // The Studio's own parser keeps no diagnostics; the package filter keeps them for the presets it packages.
  expect("diagnostics" in parseCollection(collection(diagnostics))).toBe(false);
  expect(preparePackageCollection(collection(diagnostics)).packaged.diagnostics?.presets).toEqual({
    [uuid(1)]: { plateLiftMm: 0 }, [uuid(2)]: { plateLiftMm: 0.2, surface: { RoughnessMetalnessAlpha: 0 } } });
  // Check records the lifts and each preset's knobs, so a diagnostic candidate is recognisable before and after Build.
  const check = preflightPackageCollection(collection(diagnostics));
  expect(check.plateLiftsMm).toEqual([0, 0.2, 0.4]);
  expect(check.presets.map(p => p.diagnostics)).toEqual([{ plateLiftMm: 0 }, { plateLiftMm: 0.2, surface: { RoughnessMetalnessAlpha: 0 } }, undefined]);
  expect("diagnostics" in check.presets[2]!).toBe(false);
  expect(preflightPackageCollection(collection()).plateLiftsMm).toEqual([PLATE_LIFT_MM]);
  expect(() => planCollection(collection({ ...diagnostics, presets: { [uuid(1)]: { plateLiftMm: 2 } } }))).toThrow("between 0 and");
  expect(() => planCollection(collection({ ...diagnostics, presets: { [uuid(1)]: { surface: { DiffuseAlpha: 0 } } } }))).toThrow("not an accepted override");
  expect(() => planCollection(collection({ schema: "other", presets: {} }))).toThrow("xfs/export-diagnostics-1");

  // Mesh rewrite: every appearance names each chunk; unused chunks bind the hidden entry, which writes nothing.
  const { mesh, morph } = plate(), lifted = liftPlate(mesh, morph, plan.plate.liftsMm);
  const root = rewritePlateMesh(lifted.mesh, plan, new HandleCounter()).Data.RootChunk;
  expect(root.appearances[1].Data.chunkMaterials.map((c: any) => c.$value))
    .toEqual([HIDDEN_CHUNK_ENTRY, plan.presets[1].appearance + plan.presets[1].material, HIDDEN_CHUNK_ENTRY]);
  expect(root.materialEntries.map((e: any) => e.name.$value)).toEqual(["@preset", plan.presets[1].material, HIDDEN_CHUNK_ENTRY]);
  const hidden = root.localMaterialBuffer.materials[2].values.map((v: any) => [Object.keys(v)[1], Object.values(v)[1]]);
  expect(hidden).toEqual([["DiffuseAlpha", 0], ["NormalAlpha", 0], ["RoughnessMetalnessAlpha", 0]]);
  const diag = Object.fromEntries(root.localMaterialBuffer.materials[1].values.map((v: any) => [Object.keys(v)[1], Object.values(v)[1]]));
  expect(diag.RoughnessMetalnessAlpha).toBe(0);
  expect(diag.RoughnessScale).toBe(1);
  expect(() => rewritePlateMesh(mesh, plan, new HandleCounter())).toThrow("render chunks");
});
