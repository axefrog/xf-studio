import { expect, test } from "bun:test";
import { DecodeSession, DEFAULT_LIMITS } from "../src/native/limits";
import { NativeBudgetError, NativeMalformedError, NativeUnsupportedError } from "../src/native/native-errors";
import { readCollisionActors, readSectorAppendix, readSectorPlacements, readStreamingSector, readStreamingSectorCollisions, type CollisionCounts } from "../src/native/streaming-sector";
import { Cursor } from "../src/native/red-values";
import { readResourceJson } from "../src/native/resource-document";
import { Bytes, Cr2wBuilder, prop, v } from "./fixtures/native-cr2w";
import { fakeDecompress } from "./fixtures/native-archive";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { vanillaSources } from "../../../xf-holotable/src/solid-source";
import { depotHash } from "../src/game/depot-path";
import { NativeArchivePool } from "../src/native/archive-reader";
import { loadGameOodle } from "../src/native/oodle";
import { SECTOR_SAMPLES, sectorDifferences } from "../tools/native-sector-diff";

const xyz = (w: Bytes, a: number[]) => { for (const x of a) w.f32(x); };
function placement(): Uint8Array {
  const w = new Bytes();
  xyz(w, [10, 20, 30, 1, 0, 0, 0, 1, 2, 3, 4, 1, 2, 3, -1, -2, -3, 1, 2, 3]);
  w.u64(1n).u64(2n).u64(3n).u64(4n).f32(100).f32(200).u16(0).u16(10).u16(11).u16(12).u64(13n).u64(14n);
  return w.done();
}
const counts: CollisionCounts = { numActors: 1, numShapeInfos: 5, numShapePositions: 1, numShapeRotations: 1, numScales: 1,
  numMaterials: 1, numPresets: 1, numShapeIndices: 5, numMaterialIndices: 1 };
function collision(): Uint8Array {
  const w = new Bytes();
  w.i32(131072).i32(-262144).i32(393216).i32(0); xyz(w, [0, 0, 0, 1]);
  w.u16(0).u16(5).i16(0).i16(7).u64(8n);
  for (let type = 0; type < 5; type++) {
    if (type >= 3) w.u64(9007199254740999n + BigInt(type)).f32(0); else xyz(w, [2, type === 1 ? 0 : 3, type === 0 ? 4 : 0]);
    w.i16(type).i16(0).i16(0).i16(1).i16(type === 0 ? 0 : -1).i16(type === 0 ? 0 : -1).u8(0).u8(11).u16(0).u32(0);
  }
  xyz(w, [4, 5, 6, 0, 0, 1, 0, 2, 3, 4]); w.u64(123n).u64(456n);
  for (let i = 0; i < 5; i++) w.u32(i);
  return w.u8(0).done();
}
function sector(): Uint8Array {
  const f = new Cr2wBuilder(), nodeData = f.buffer(placement()), compiled = f.buffer(collision());
  f.export("worldStreamingSector", [], (w, file) => {
    w.i32(62); const size = w.length; w.i32(0); v.buffer(nodeData)(w);
    w.u8(1).i32(2).u8(1); v.string("$/synthetic")(w); w.u8(1).i32(0).i32(-1); w.set32(size, w.length - size);
  });
  f.export("worldCollisionNode", [prop("compiledData", "DataBuffer", v.buffer(compiled)),
    ...Object.entries(counts).map(([name, n]) => prop(name, "Uint16", v.u16(n)))]);
  return f.build();
}

test("the additive sector entry point joins its appendix, placements and compiled actors", () => {
  const s = readStreamingSector(sector(), fakeDecompress);
  const bulk = readStreamingSectorCollisions(sector(), fakeDecompress);
  expect(bulk.collisions).toEqual(s.collisions); expect(bulk.placements).toEqual(s.placements.map(p => ({ nodeIndex: p.nodeIndex })));
  expect(s.version).toBe(62); expect(s.nodes).toEqual([1]); expect(s.nodeRefs).toEqual(["$/synthetic"]);
  expect(s.variantIndices).toEqual([0]); expect(s.persistentNodeIndex).toBe(-1);
  expect(s.placements[0]).toEqual({ position: [10, 20, 30], positionW: 1, orientation: [0, 0, 0, 1], scale: [2, 3, 4],
    pivot: [1, 2, 3], bounds: { min: [-1, -2, -3], max: [1, 2, 3] }, id: "1", questPrefabRefHash: "2", ukHash1: "3", cookedPrefabData: "4",
    maxStreamingDistance: 100, ukFloat1: 200, nodeIndex: 0, unknown16: [10, 11, 12], unknown64: ["13", "14"] });
  const a = s.collisions[0].actors[0];
  expect(a.position).toEqual([1, -2, 3]); expect(a.scale).toEqual([2, 3, 4]); expect(a.uk1).toBe(7); expect(a.uk2).toBe("8");
  expect(a.shapes.map(s => s.type)).toEqual(["Box", "Sphere", "Capsule", "ConvexMesh", "TriangleMesh"]);
  expect(a.shapes[0]).toMatchObject({ size: [2, 3, 4], position: [4, 5, 6], rotation: [0, 0, 1, 0], materials: ["123"], preset: "456" });
  expect(a.shapes[1]).toMatchObject({ size: [2, 0, 0], position: [0, 0, 0], rotation: [0, 0, 0, 1] });
  expect(a.shapes[3].size).toBeUndefined(); expect(a.shapes[3].hash).toBe("9007199254741002");
  // No change to the resolver's existing read path or its refusal of unknown trailing data.
  expect(() => readResourceJson(sector(), fakeDecompress)).toThrow(NativeUnsupportedError);
});

test("truncated placements, invalid node indexes and non-finite transforms refuse with a typed error", () => {
  expect(() => readSectorPlacements(placement().slice(1), 1)).toThrow(NativeMalformedError);
  expect(() => readSectorPlacements(placement(), 0)).toThrow(NativeMalformedError);
  const b = placement(); new DataView(b.buffer).setFloat32(0, NaN, true);
  expect(() => readSectorPlacements(b, 1)).toThrow(NativeMalformedError);
});

test("the verified positive-infinity streaming-distance sentinel is preserved, but NaN is refused", () => {
  const b = placement(), view = new DataView(b.buffer); view.setFloat32(112, Infinity, true);
  expect(readSectorPlacements(b, 1)[0].maxStreamingDistance).toBe(Infinity);
  view.setFloat32(112, NaN, true); expect(() => readSectorPlacements(b, 1)).toThrow(NativeMalformedError);
});

test("collision counts, table indexes, shape ranges and dimensions are bounded before allocation", () => {
  expect(() => readCollisionActors(collision().slice(1), counts)).toThrow(NativeMalformedError);
  expect(() => readCollisionActors(collision(), { ...counts, numActors: 65536 })).toThrow(NativeMalformedError);
  for (const [offset, value] of [[32, 65535], [48 + 20, 2], [48 + 18, 2], [48 + 12, 6]] as const) {
    const b = collision(); new DataView(b.buffer).setUint16(offset, value, true);
    expect(() => readCollisionActors(b, counts)).toThrow(offset === 60 ? NativeUnsupportedError : NativeMalformedError);
  }
  const b = collision(); new DataView(b.buffer).setFloat32(48, -1, true);
  expect(() => readCollisionActors(b, counts)).toThrow(NativeMalformedError);
  const tiny = new DecodeSession({ ...DEFAULT_LIMITS, maxNodes: 10 });
  expect(() => readCollisionActors(collision(), counts, tiny)).toThrow(NativeBudgetError);
});

test("unknown appendix versions, short sizes and overflowing VLQ counts refuse", () => {
  const w = new Bytes().i32(63).i32(4);
  expect(() => readSectorAppendix(new Cursor(w.done()), () => null)).toThrow(NativeUnsupportedError);
  const bad = new Bytes().i32(62).i32(5).u8(64).done();
  expect(() => readSectorAppendix(new Cursor(bad), () => null)).toThrow(NativeMalformedError);
  const huge = new Bytes().i32(62).i32(9).u8(64).u8(255).u8(255).u8(255).u8(127).done();
  expect(() => readSectorAppendix(new Cursor(huge), () => null)).toThrow(NativeMalformedError);
});

// No game payload fixtures. Generate private references with tools/native-sector-diff.ts, under the memory guard.
const game = process.env.XFS_TEST_GAME_ROOT, oracle = process.env.XFS_TEST_SECTOR_ORACLE;
for (const path of SECTOR_SAMPLES) (game && oracle ? test : test.skip)(`real sector matches WolvenKit: ${path}`, () => {
  const oodle = loadGameOodle(game!), pool = new NativeArchivePool(oodle.decompress);
  try {
    const hash = depotHash(path), bytes = vanillaSources(game!).map(s => pool.read(s.path, hash)).find(b => b !== null);
    expect(bytes).not.toBeUndefined();
    const reference = JSON.parse(readFileSync(join(oracle!, path.replaceAll("\\", "/") + ".json"), "utf8"));
    const full = readStreamingSector(bytes!, oodle.decompress), bulk = readStreamingSectorCollisions(bytes!, oodle.decompress);
    expect(sectorDifferences(full, reference)).toEqual([]);
    expect(bulk.collisions).toEqual(full.collisions); expect(bulk.placements).toEqual(full.placements.map(p => ({ nodeIndex: p.nodeIndex })));
  } finally { pool.close(); oodle.close(); }
});
